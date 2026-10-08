import { Request, Response } from 'express';
import crypto from 'crypto';
import { mailerService } from '../services/mailerService.js';
import { Tenant, User, APIKey } from '../models/index.js';
import { generateTokens, refreshTokens, asyncHandler, AppError } from '../middleware/index.js';
import { setAuthCookies, clearAuthCookies } from '../middleware/cookies.js';
import { runInTransaction } from '../utils/transactions.js';
import { subscriptionPlans } from '../config/index.js';

/**
 * Register a new tenant
 * POST /api/v1/auth/register
 */
export const register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { name, email, password, company, website } = req.body;
  
  // Check if email already exists
  const existingTenant = await Tenant.findOne({ email: email.toLowerCase() });
  if (existingTenant) {
    throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');
  }
  
  // Generate slug from name
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let slug = baseSlug;
  let counter = 1;
  
  // Ensure unique slug
  while (await Tenant.findOne({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  
  // Create tenant + owner atomically (no orphan tenant on partial failure)
  const { tenant, user } = await runInTransaction(async (session) => {
    const opts = session ? { session } : {};
    const newTenant = await Tenant.create(
      [
        {
          name,
          slug,
          email: email.toLowerCase(),
          password,
          company,
          website,
          subscription: {
            plan: 'free',
            startDate: new Date(),
            isActive: true,
            billingCycle: 'monthly',
          },
        },
      ],
      opts
    ).then((docs) => docs[0]);

    const newUser = await User.create(
      [
        {
          tenantId: newTenant._id,
          email: email.toLowerCase(),
          password,
          firstName: name.trim().split(/\s+/)[0] || name,
          lastName: name.trim().split(/\s+/).slice(1).join(' '),
          role: 'owner',
          isEmailVerified: false,
        },
      ],
      opts
    ).then((docs) => docs[0]);

    return { tenant: newTenant, user: newUser };
  });
  
  // Generate tokens
  const tokens = generateTokens(user._id.toString(), tenant._id.toString(), user.role, false, user.tokenVersion || 0);
  setAuthCookies(res, tokens);

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: {
      tenant: {
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        email: tenant.email,
        subscription: tenant.subscription,
      },
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      tokens,
    },
  });
});

/**
 * Login
 * POST /api/v1/auth/login
 */
export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  
  // Find user with password
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  
  if (!user) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }
  
  // Check password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }
  
  // Check if user is active
  if (!user.isActive) {
    throw new AppError('Account is deactivated', 403, 'ACCOUNT_INACTIVE');
  }
  
  // Get tenant
  const tenant = await Tenant.findById(user.tenantId);
  if (!tenant || !tenant.isActive) {
    throw new AppError('Tenant not found or inactive', 403, 'TENANT_INACTIVE');
  }
  
  // Generate tokens (mfaVerified is false initially)
  const tokens = generateTokens(user._id.toString(), tenant._id.toString(), user.role, false, user.tokenVersion || 0);
  setAuthCookies(res, tokens);
  
  if (user.twoFactorEnabled) {
    res.json({
      success: true,
      data: {
        mfaRequired: true,
        tokens, // Frontend will use this temporary token to verify MFA
      },
    });
    return;
  }

  // Update last login
  user.lastLoginAt = new Date();
  await user.save();
  
  res.json({
    success: true,
    message: 'Login successful',
    data: {
      tenant: {
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        subscription: tenant.subscription,
      },
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        permissions: user.permissions,
      },
      tokens,
    },
  });
});

/**
 * Refresh tokens — accepts the refresh token from the httpOnly cookie
 * (browsers) or the request body (native clients).
 * POST /api/v1/auth/refresh
 */
export const refresh = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const refreshToken = (req.cookies?.refreshToken as string | undefined) || req.body?.refreshToken;

  if (!refreshToken) {
    throw new AppError('Refresh token required', 400);
  }

  const tokens = await refreshTokens(refreshToken);

  if (!tokens) {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  setAuthCookies(res, tokens);

  res.json({
    success: true,
    data: { tokens },
  });
});

/**
 * Logout — revokes all sessions by bumping tokenVersion and clears cookies.
 * POST /api/v1/auth/logout
 */
export const logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (req.userId) {
    await User.findByIdAndUpdate(req.userId, { $inc: { tokenVersion: 1 } }).exec();
  }
  clearAuthCookies(res);
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

/**
 * Forgot password (admin/dashboard users)
 * POST /api/v1/auth/forgot-password
 * Always returns generic success to avoid user enumeration.
 */
export const forgotPassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;

  const genericResponse = {
    success: true,
    message: 'If the email exists, a password reset link has been sent',
  };

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user || !user.isActive) {
    res.json(genericResponse);
    return;
  }

  // Generate single-use reset token (store only the hash)
  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await user.save({ validateBeforeSave: false });

  await sendPasswordResetEmail(user.email, resetToken, user.firstName);

  res.json(genericResponse);
});

/**
 * Reset password (admin/dashboard users)
 * POST /api/v1/auth/reset-password
 */
export const resetPassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { token, password } = req.body;

  if (!token || !password) {
    throw new AppError('Reset token and new password are required', 400, 'VALIDATION_ERROR');
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: new Date() },
  }).select('+password');

  if (!user || !user.isActive) {
    throw new AppError('Invalid or expired reset token', 400, 'INVALID_TOKEN');
  }

  user.password = password; // pre-save hook hashes it
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  // Invalidate all existing sessions (stolen session dies with the reset)
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  res.json({
    success: true,
    message: 'Password reset successfully',
  });
});

/**
 * Send the password reset email. Falls back to console logging when
 * SMTP is not configured so self-hosted dev setups never crash.
 */
const sendPasswordResetEmail = async (to: string, token: string, firstName: string): Promise<void> => {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5174'}/reset-password?token=${token}`;

  if (!mailerService.isPlatformConfigured()) {
    // Never log the email/token — the link is single-use credentials
    console.log('[auth] SMTP not configured — password reset link generated (see user inbox when SMTP is set)');
    return;
  }

  try {
    await mailerService.send({
      category: 'system',
      throwOnError: true,
      to,
      subject: 'Reset your password',
      html: `
        <h2>Password reset</h2>
        <p>Hi ${firstName || 'there'},</p>
        <p>Click the link below to reset your password. It expires in 1 hour.</p>
        <a href="${resetUrl}">Reset password</a>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });
  } catch (error) {
    console.error('Failed to send password reset email:', error);
  }
};

/**
 * Get current user profile
 * GET /api/v1/auth/me
 */
export const getProfile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const user = req.user;
  const tenant = req.tenant;
  
  // Get plan limits
  const planLimits = subscriptionPlans[tenant!.subscription.plan];
  
  res.json({
    success: true,
    data: {
      user: {
        id: user!._id,
        email: user!.email,
        firstName: user!.firstName,
        lastName: user!.lastName,
        avatar: user!.avatar,
        role: user!.role,
        permissions: user!.permissions,
      },
      tenant: {
        id: tenant!._id,
        name: tenant!.name,
        slug: tenant!.slug,
        email: tenant!.email,
        company: tenant!.company,
        logo: tenant!.logo,
        subscription: tenant!.subscription,
        usage: tenant!.usage,
        planLimits: planLimits.limits,
      },
    },
  });
});

/**
 * Update profile
 * PUT /api/v1/auth/profile
 */
export const updateProfile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { firstName, lastName, avatar } = req.body;
  
  const user = await User.findByIdAndUpdate(
    req.userId,
    { firstName, lastName, avatar },
    { new: true, runValidators: true }
  );
  
  res.json({
    success: true,
    message: 'Profile updated',
    data: { user },
  });
});

/**
 * Change password
 * PUT /api/v1/auth/password
 */
export const changePassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body;
  
  const user = await User.findById(req.userId).select('+password');
  
  if (!user) {
    throw new AppError('User not found', 404);
  }
  
  // Verify current password
  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw new AppError('Current password is incorrect', 400);
  }
  
  // Update password
  user.password = newPassword;
  await user.save();

  // Invalidate all other sessions; re-issue cookies for this one
  await User.findByIdAndUpdate(user._id, { $inc: { tokenVersion: 1 } }).exec();
  const fresh = await User.findById(user._id);
  const tokens = generateTokens(
    user._id.toString(),
    (fresh?.tenantId || user.tenantId).toString(),
    user.role,
    false,
    fresh?.tokenVersion || 0
  );
  setAuthCookies(res, tokens);

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
});

/**
 * Generate API Key
 * POST /api/v1/auth/api-keys
 */
export const createAPIKey = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { name, description, permissions, allowedOrigins, expiresAt } = req.body;
  
  // Generate key pair
  const keyPair = APIKey.generateKeyPair();
  
  // Create API key
  const apiKey = await APIKey.create({
    tenantId: req.tenantId,
    name,
    description,
    apiKey: keyPair.apiKey,
    apiKeyHash: keyPair.apiKeyHash,
    secretKey: keyPair.secretKey,
    secretKeyHash: keyPair.secretKeyHash,
    keyPrefix: keyPair.apiKey.slice(0, 12),
    permissions: permissions || ['content:read'],
    allowedOrigins: allowedOrigins || [],
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    createdBy: req.userId,
  });
  
  // Return with secret (only time it's shown)
  res.status(201).json({
    success: true,
    message: 'API key created. Save the secret key - it will not be shown again!',
    data: {
      id: apiKey._id,
      name: apiKey.name,
      apiKey: keyPair.apiKey,
      secretKey: keyPair.secretKey, // Only shown once!
      permissions: apiKey.permissions,
      allowedOrigins: apiKey.allowedOrigins,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    },
  });
});

/**
 * Get all API Keys for tenant
 * GET /api/v1/auth/api-keys
 */
export const getAPIKeys = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const apiKeys = await APIKey.find({ 
    tenantId: req.tenantId,
    isActive: true,
  }).select('-apiKey -secretKey -apiKeyHash -secretKeyHash');
  
  res.json({
    success: true,
    data: { apiKeys },
  });
});

/**
 * Delete API Key
 * DELETE /api/v1/auth/api-keys/:id
 */
export const deleteAPIKey = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  
  const apiKey = await APIKey.findOneAndUpdate(
    { _id: id, tenantId: req.tenantId },
    { isActive: false },
    { new: true }
  );
  
  if (!apiKey) {
    throw new AppError('API key not found', 404);
  }
  
  res.json({
    success: true,
    message: 'API key deleted',
  });
});
