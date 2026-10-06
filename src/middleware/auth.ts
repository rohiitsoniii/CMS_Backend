import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { Tenant, User, type ITenant, type IUser } from '../models/index.js';

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
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'No token provided',
      });
      return;
    }
    
    const token = authHeader.split(' ')[1];
    
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
 * Generate JWT tokens
 */
export const generateTokens = (userId: string, tenantId: string, role: string, mfaVerified: boolean = false) => {
  const accessToken = jwt.sign(
    { userId, tenantId, role, mfaVerified, type: 'access' },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as any }
  );
  
  const refreshToken = jwt.sign(
    { userId, tenantId, role, mfaVerified, type: 'refresh' },
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
    
    // Generate new tokens (carry over MFA verification state)
    return generateTokens(decoded.userId, decoded.tenantId || user.tenantId.toString(), decoded.role, decoded.mfaVerified);
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

