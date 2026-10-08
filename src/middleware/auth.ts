import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { Tenant, User, type ITenant, type IUser } from '../models/index.js';
import { authenticateManagementApiKey } from './apiKeyAuth.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      tenant?: ITenant;
      user?: IUser;
      userId?: string;
      tenantId?: string;
    }
  }
}

interface JwtPayload {
  userId: string;
  tenantId?: string;
  role: string;
  type: 'access' | 'refresh';
  mfaVerified?: boolean;
  v?: number;
  iat: number;
  exp: number;
}


/**
 * Middleware to authenticate admin dashboard users via JWT
 */
export const authenticateJWT = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    // Bearer header first, httpOnly cookie second (browsers)
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : (req.cookies?.accessToken as string | undefined);

    // API-only mode: server-side code can use an API key + secret instead of a session
    if (!authHeader?.startsWith('Bearer ') && req.headers['x-api-key']) {
      return authenticateManagementApiKey(req, res, next);
    }

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'No token provided',
      });
      return;
    }
    
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
      
      if (decoded.type !== 'access') {
        res.status(401).json({
          success: false,
          error: 'Invalid token type',
          message: 'Access token required',
        });
        return;
      }
      
      // Get user
      const user = await User.findById(decoded.userId);

      if (!user || !user.isActive) {
        res.status(401).json({
          success: false,
          error: 'User not found or inactive',
        });
        return;
      }

      // Reject tokens issued before logout/password change
      if (decoded.v !== undefined && decoded.v !== (user.tokenVersion || 0)) {
        res.status(401).json({
          success: false,
          error: 'Session revoked',
          message: 'Please sign in again',
        });
        return;
      }
      
      // Check 2FA compliance
      if (user.twoFactorEnabled && !decoded.mfaVerified) {
        res.status(403).json({
          success: false,
          error: 'MFA verification required',
          code: 'MFA_REQUIRED',
        });
        return;
      }
      
      // If user is super admin, tenant is optional for system routes
      // But if tenantId is provided in token, we still verify it
      let tenant = null;
      if (decoded.tenantId) {
        tenant = await Tenant.findById(decoded.tenantId);
        
        if (!tenant || !tenant.isActive) {
           // If user is NOT super admin but tenant is missing/inactive, fail
           if (!user.isSuperAdmin) {
             res.status(401).json({
               success: false,
               error: 'Tenant not found or inactive',
             });
             return;
           }
        }
      } else if (!user.isSuperAdmin) {
        // Normal user MUST have a tenantId
        res.status(401).json({
          success: false,
          error: 'Missing tenant context',
        });
        return;
      }
      
      // Attach to request
      req.user = user;
      req.tenant = tenant as any;
      req.userId = decoded.userId;
      req.tenantId = decoded.tenantId;

      
      next();
    } catch (jwtError) {
      if (jwtError instanceof jwt.TokenExpiredError) {
        res.status(401).json({
          success: false,
          error: 'Token expired',
          message: 'Please refresh your token',
        });
        return;
      }
      
      res.status(401).json({
        success: false,
        error: 'Invalid token',
      });
    }
  } catch (error) {
    next(error);
  }
};

// Alias for authenticateJWT
export const authenticate = authenticateJWT;

/**
 * Middleware for MFA verification step: authenticates a valid access token
 * WITHOUT enforcing the mfaVerified flag, so a pre-MFA (mfaVerified=false)
 * temporary token can call POST /two-factor/verify and nothing else.
 * All other routes must keep using authenticateJWT.
 */
export const authenticateAllowUnverifiedMfa = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : (req.cookies?.accessToken as string | undefined);

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'No token provided',
      });
      return;
    }

    try {
      const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

      if (decoded.type !== 'access') {
        res.status(401).json({
          success: false,
          error: 'Invalid token type',
          message: 'Access token required',
        });
        return;
      }

      const user = await User.findById(decoded.userId);

      if (!user || !user.isActive) {
        res.status(401).json({
          success: false,
          error: 'User not found or inactive',
        });
        return;
      }

      if (decoded.v !== undefined && decoded.v !== (user.tokenVersion || 0)) {
        res.status(401).json({
          success: false,
          error: 'Session revoked',
          message: 'Please sign in again',
        });
        return;
      }

      let tenant = null;
      if (decoded.tenantId) {
        tenant = await Tenant.findById(decoded.tenantId);

        if (!tenant || !tenant.isActive) {
          if (!user.isSuperAdmin) {
            res.status(401).json({
              success: false,
              error: 'Tenant not found or inactive',
            });
            return;
          }
        }
      } else if (!user.isSuperAdmin) {
        res.status(401).json({
          success: false,
          error: 'Missing tenant context',
        });
        return;
      }

      req.user = user;
      req.tenant = tenant as any;
      req.userId = decoded.userId;
      req.tenantId = decoded.tenantId;

      next();
    } catch (jwtError) {
      if (jwtError instanceof jwt.TokenExpiredError) {
        res.status(401).json({
          success: false,
          error: 'Token expired',
          message: 'Please refresh your token',
        });
        return;
      }

      res.status(401).json({
        success: false,
        error: 'Invalid token',
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware for tenant owner authentication (initial login)
 */
export const authenticateTenant = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
      
      const tenant = await Tenant.findById(decoded.tenantId);
      
      if (!tenant || !tenant.isActive) {
        res.status(401).json({
          success: false,
          error: 'Tenant not found or inactive',
        });
        return;
      }
      
      req.tenant = tenant;
      req.tenantId = decoded.tenantId;
      
      next();
    } catch {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Generate JWT tokens. tokenVersion binds tokens to the user's current
 * session generation — bumped on logout/password change to revoke all.
 */
export const generateTokens = (userId: string, tenantId: string, role: string, mfaVerified: boolean = false, tokenVersion = 0) => {
  const accessToken = jwt.sign(
    { userId, tenantId, role, mfaVerified, v: tokenVersion, type: 'access' },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as any }
  );

  const refreshToken = jwt.sign(
    { userId, tenantId, role, mfaVerified, v: tokenVersion, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn as any }
  );

  return { accessToken, refreshToken };
};

/**
 * Verify refresh token and generate new tokens
 */
export const refreshTokens = async (
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string } | null> => {
  try {
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as JwtPayload;
    
    if (decoded.type !== 'refresh') {
      return null;
    }
    
    // Verify user still exists and is active
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return null;
    }

    // Reject refresh tokens from a revoked session generation
    if (decoded.v !== undefined && decoded.v !== (user.tokenVersion || 0)) {
      return null;
    }

    // Generate new tokens (carry over MFA verification state + version)
    return generateTokens(decoded.userId, decoded.tenantId || user.tenantId.toString(), decoded.role, decoded.mfaVerified, user.tokenVersion || 0);
  } catch {
    return null;
  }
};

/**
 * Permission check middleware
 */
export const requirePermission = (...permissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }
    
    if (req.user.role === 'owner' || req.user.role === 'admin' || req.user.isSuperAdmin) {
      return next();
    }
    
    const userPermissions = req.user.permissions || [];
    const hasPermission = permissions.some(p => userPermissions.includes(p) || userPermissions.includes('*'));
    
    if (!hasPermission) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        required: permissions,
      });
      return;
    }
    
    next();
  };
};

/**
 * Role check middleware
 */
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }
    
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient role privileges',
        required: roles,
      });
      return;
    }
    
    next();
  };
};

/**
 * Super Admin check middleware
 */
export const requireSuperAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user || (!req.user.isSuperAdmin && req.user.role !== 'owner' && req.user.role !== 'admin' && config.nodeEnv !== 'development')) {
    res.status(403).json({
      success: false,
      error: 'Insufficient privilege',
      message: 'Super Admin access required',
    });
    return;
  }
  
  next();
};

