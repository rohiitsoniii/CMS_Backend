import crypto from 'crypto';
import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/index.js';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Content } from '../models/Content.js';
import { TeamMember } from '../models/TeamMember.js';
import { APIKey } from '../models/APIKey.js';
import { AuditLog } from '../models/AuditLog.js';
import { ConsentLog } from '../models/ConsentLog.js';
import { AuditService } from '../services/AuditService.js';
import { runInTransaction } from '../utils/transactions.js';

const sanitizeUser = (user: any): Record<string, unknown> => ({
  id: user._id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  avatar: user.avatar,
  role: user.role,
  isEmailVerified: user.isEmailVerified,
  twoFactorEnabled: user.twoFactorEnabled,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

/**
 * GDPR Article 15 — Right of access.
 * GET /api/v1/gdpr/export
 * Returns every personal-data record held about the caller as JSON.
 */
export const exportData = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const tenantId = req.tenantId!;
  const [projects, contents, memberships, apiKeys, auditLogs, consents] = await Promise.all([
    Project.find({ createdBy: userId }).select('-__v'),
    Content.find({ $or: [{ createdBy: userId }, { updatedBy: userId }] }).select('-__v'),
    TeamMember.find({ $or: [{ userId }, { email: user.email }] }),
    APIKey.find({ createdBy: userId }).select('-apiKeyHash -secretKey -secretKeyHash'),
    AuditLog.find({ 'actor.userId': userId }).sort({ createdAt: -1 }).limit(500),
    ConsentLog.find({ $or: [{ userId }, { tenantId }] }).sort({ createdAt: -1 }).limit(500),
  ]);

  await AuditService.log(req, 'gdpr.export', { type: 'User', id: String(userId), name: user.email });

  res.json({
    success: true,
    data: {
      profile: sanitizeUser(user),
      projects,
      contents,
      teamMemberships: memberships,
      apiKeys,
      auditLogs,
      consentLogs: consents,
      generatedAt: new Date().toISOString(),
    },
  });
});

/**
 * GDPR Article 17 — Right to erasure.
 * POST /api/v1/gdpr/erase { password }
 *
 * Uses scrub + deactivate (never hard-delete): preserves referential
 * integrity for content authored by the user while destroying PII and
 * blocking all future logins. Team memberships are removed and API keys
 * created by the user are revoked.
 *
 * Safety: sole owners of tenants that still have projects or other
 * members are blocked (409) until ownership is transferred.
 */
export const eraseAccount = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const { password } = req.body;

  if (!password) {
    throw new AppError('Password confirmation is required', 400, 'VALIDATION_ERROR');
  }

  const user = await User.findById(userId).select('+password');
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const passwordOk = await user.comparePassword(password);
  if (!passwordOk) {
    throw new AppError('Invalid password', 401, 'INVALID_CREDENTIALS');
  }

  // Sole-owner guard: an owner cannot erase while their tenant still
  // has projects or other active members (would orphan the workspace).
  if (user.role === 'owner' && req.tenantId) {
    const [ownerCount, projectCount, memberCount] = await Promise.all([
      User.countDocuments({ tenantId: req.tenantId, role: 'owner', isActive: true }),
      Project.countDocuments({ tenantId: req.tenantId }),
      TeamMember.countDocuments({ status: 'active', userId: { $ne: userId } }),
    ]);
    if (ownerCount <= 1 && (projectCount > 0 || memberCount > 0)) {
      res.status(409).json({
        success: false,
        error: 'Sole owner cannot erase account',
        message: 'Transfer ownership or delete the workspace contents first',
        blockers: { projects: projectCount, activeMemberships: memberCount },
      });
      return;
    }
  }

  // Scrub PII + deactivate (login checks isActive)
  user.firstName = 'Deleted';
  user.lastName = 'User';
  user.email = `deleted_${String(user._id)}@deleted.local`;
  user.avatar = undefined;
  user.password = crypto.randomBytes(32).toString('hex');
  user.isActive = false;
  user.isEmailVerified = false;
  user.twoFactorEnabled = false;
  user.emailVerificationToken = undefined;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  // Scrub + membership removal + key revocation happen atomically —
  // a partial erase would be worse than none (data subject told "erased").
  await runInTransaction(async (session) => {
    const opts = session ? { session } : {};
    await user.save(opts);
    // Remove memberships, revoke keys created by the user
    await TeamMember.deleteMany({ $or: [{ userId }, { email: req.user!.email }] }, opts);
    await APIKey.updateMany({ createdBy: userId }, { $set: { isActive: false } }, opts);
  });

  await AuditService.log(req, 'gdpr.erase', { type: 'User', id: String(userId), name: 'erased-user' });

  res.json({
    success: true,
    message: 'Account erased. Profile data destroyed and login disabled.',
  });
});
