import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { APIKey, Tenant, type ITenant, type IAPIKey } from '../models/index.js';
import { getRedisClient } from '../config/redis.js';

// Extend Express Request type for API key auth
declare global {
  namespace Express {
    interface Request {
      apiKey?: IAPIKey;
    }
  }
}

/**
 * Middleware to authenticate public API requests via API Key
 */
export const authenticateAPIKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const apiKeyHeader = req.headers['x-api-key'] as string;
    const secretKeyHeader = req.headers['x-api-secret'] as string;
    
    if (!apiKeyHeader) {
      res.status(401).json({
        success: false,
        error: 'API key required',
        message: 'Please provide X-API-Key header',
      });
      return;
    }
    
    // Find API key in database
    const apiKeyDoc = await APIKey.findOne({ 
      apiKey: apiKeyHeader,
      isActive: true,
    }).select('+apiKeyHash +secretKeyHash');
    
    if (!apiKeyDoc) {
      res.status(401).json({
        success: false,
        error: 'Invalid API key',
      });
      return;
    }
    
    // Check if API key is expired
    if (apiKeyDoc.expiresAt && apiKeyDoc.expiresAt < new Date()) {
      res.status(401).json({
        success: false,
        error: 'API key expired',
      });
      return;
    }
    
    // Verify secret key if provided (optional for read operations)
    if (secretKeyHeader) {
      const secretKeyHash = crypto
        .createHmac('sha256', config.apiKeySecret)
        .update(secretKeyHeader)
        .digest('hex');
      
      if (secretKeyHash !== apiKeyDoc.secretKeyHash) {
        res.status(401).json({
          success: false,
          error: 'Invalid API secret',
        });
        return;
      }
    }
    
    // Check origin if allowedOrigins is set
    const origin = req.headers.origin || req.headers.referer;
    if (apiKeyDoc.allowedOrigins.length > 0 && origin) {
      const isAllowed = apiKeyDoc.allowedOrigins.some(allowed => {
        if (allowed === '*') return true;
        return origin.includes(allowed);
      });
      
      if (!isAllowed) {
        res.status(403).json({
          success: false,
          error: 'Origin not allowed',
        });
        return;
      }
    }
    
    // Get tenant
    const tenant = await Tenant.findById(apiKeyDoc.tenantId);
    
    if (!tenant || !tenant.isActive) {
      res.status(401).json({
        success: false,
        error: 'Tenant not found or inactive',
      });
      return;
    }
    
    // Check subscription status
    if (!tenant.subscription.isActive) {
      res.status(403).json({
        success: false,
        error: 'Subscription inactive',
        message: 'Please renew your subscription',
      });
      return;
    }
    
    // Update last used timestamp (async, don't wait)
    APIKey.updateOne(
      { _id: apiKeyDoc._id },
      { 
        lastUsedAt: new Date(),
        $inc: { usageCount: 1 },
      }
    ).exec().catch(console.error);
    
    // Attach to request
    req.apiKey = apiKeyDoc;
    req.tenant = tenant;
    req.tenantId = tenant._id.toString();
    
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Rate limiter for API key requests
 */
export const apiKeyRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const redis = getRedisClient();
    
    if (!redis || !req.apiKey || !req.tenant) {
      next();
      return;
    }
    
    const tenantId = req.tenant._id.toString();
    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    
    // Per-minute rate limit key
    const minuteKey = `ratelimit:${tenantId}:minute:${Math.floor(now / windowMs)}`;
    
    // Per-day rate limit key
    const dayKey = `ratelimit:${tenantId}:day:${new Date().toISOString().slice(0, 10)}`;
    
    // Get current counts
    const [minuteCount, dayCount] = await Promise.all([
      redis.incr(minuteKey),
      redis.incr(dayKey),
    ]);
    
    // Set expiry on first request
    if (minuteCount === 1) {
      await redis.expire(minuteKey, 60);
    }
    if (dayCount === 1) {
      await redis.expire(dayKey, 86400);
    }
    
    // Check limits from API key
    const maxPerMinute = req.apiKey.rateLimit.requestsPerMinute || 60;
    const maxPerDay = req.apiKey.rateLimit.requestsPerDay || 10000;
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit-Minute', maxPerMinute);
    res.setHeader('X-RateLimit-Remaining-Minute', Math.max(0, maxPerMinute - minuteCount));
    res.setHeader('X-RateLimit-Limit-Day', maxPerDay);
    res.setHeader('X-RateLimit-Remaining-Day', Math.max(0, maxPerDay - dayCount));
    
    // Check if limit exceeded
    if (minuteCount > maxPerMinute) {
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Too many requests per minute',
        retryAfter: 60,
      });
      return;
    }
    
    if (dayCount > maxPerDay) {
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Daily request limit exceeded',
        retryAfter: 86400,
      });
      return;
    }
    
    next();
  } catch (error) {
    // If Redis fails, continue without rate limiting
    console.error('Rate limiter error:', error);
    next();
  }
};

/**
 * Check subscription limits for API calls
 */
export const checkSubscriptionLimits = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.tenant) {
      next();
      return;
    }
    
    const tenant = req.tenant;
    
    // Reset usage if new month
    tenant.resetUsageIfNewMonth();
    
    // Get plan limits from config
    const { subscriptionPlans } = await import('../config/index.js');
    const planLimits = subscriptionPlans[tenant.subscription.plan]?.limits;
    
    if (!planLimits) {
      next();
      return;
    }
    
    // Check API calls limit (-1 means unlimited)
    if (planLimits.apiCallsPerMonth !== -1) {
      if (tenant.usage.apiCalls >= planLimits.apiCallsPerMonth) {
        res.status(429).json({
          success: false,
          error: 'API limit exceeded',
          message: 'Monthly API call limit reached. Please upgrade your plan.',
          usage: {
            current: tenant.usage.apiCalls,
            limit: planLimits.apiCallsPerMonth,
          },
        });
        return;
      }
    }
    
    // Increment API call count (async)
    Tenant.updateOne(
      { _id: tenant._id },
      { 
        $inc: { 'usage.apiCalls': 1 },
        'usage.currentMonth': new Date().toISOString().slice(0, 7),
      }
    ).exec().catch(console.error);
    
    next();
  } catch (error) {
    next(error);
  }
};
