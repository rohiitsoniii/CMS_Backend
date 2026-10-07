import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { APIKey, Tenant } from '../models/index.js';
import type { IAPIKey } from '../models/APIKey.js';
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
 * HMAC-SHA256 lookup hash for a presented API key. Keys are NEVER queried
 * or stored in plaintext — only this hash touches the database.
 */
export const hashPresentedKey = (presentedKey: string): string =>
  crypto.createHmac('sha256', config.apiKeySecret).update(presentedKey).digest('hex');

const timingSafeEqualHex = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

/**
 * Origin allow-list check. Exact hostname match or subdomain of an allowed
 * entry (parsed as URL when possible). '*' preserves the legacy wildcard.
 */
export const isOriginAllowed = (origin: string | undefined, allowedOrigins: string[]): boolean => {
  if (!allowedOrigins || allowedOrigins.length === 0) return true;
  if (!origin) return true; // non-browser clients send no Origin/Referer
  if (allowedOrigins.includes('*')) return true;

  const hostOf = (value: string): string => {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return value.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    }
  };

  let originHost: string;
  try {
    originHost = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  return allowedOrigins.some((allowed) => {
    const allowedHost = hostOf(allowed);
    return originHost === allowedHost || originHost.endsWith(`.${allowedHost}`);
  });
};

/**
 * Middleware to authenticate public API requests via API Key
 */
export const authenticateAPIKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let apiKeyHeader = req.headers['x-api-key'] as string;
    const secretKeyHeader = req.headers['x-api-secret'] as string;
    
    // Support standard Bearer token header if X-API-Key header is absent
    if (!apiKeyHeader && req.headers.authorization?.startsWith('Bearer ')) {
      apiKeyHeader = req.headers.authorization.split(' ')[1];
    }
    
    if (!apiKeyHeader) {
      res.status(401).json({
        success: false,
        error: 'API key required',
        message: 'Please provide X-API-Key header or Bearer token',
      });
      return;
    }
    
    // Find API key by hash — plaintext never touches a query
    const presentedHash = hashPresentedKey(apiKeyHeader);
    let apiKeyDoc = await APIKey.findOne({
      apiKeyHash: presentedHash,
      isActive: true,
    }).select('+apiKeyHash +secretKeyHash');

    // Legacy fallback: rows created before hashes were backfilled.
    // On match, backfill the hash so the next request takes the fast path.
    if (!apiKeyDoc) {
      const legacy = await APIKey.findOne({
        apiKey: apiKeyHeader,
        isActive: true,
      }).select('+apiKey +secretKey +apiKeyHash +secretKeyHash');
      if (legacy) {
        const backfill: Record<string, string> = { apiKeyHash: hashPresentedKey(apiKeyHeader) };
        if (legacy.secretKey) {
          backfill.secretKeyHash = crypto
            .createHmac('sha256', config.apiKeySecret)
            .update(legacy.secretKey)
            .digest('hex');
        }
        await APIKey.updateOne({ _id: legacy._id }, { $set: backfill }).exec();
        console.warn(`[apiKeyAuth] backfilled hash for legacy key ${String(legacy._id)}`);
        apiKeyDoc = await APIKey.findOne({
          apiKeyHash: presentedHash,
          isActive: true,
        }).select('+apiKeyHash +secretKeyHash');
      }
    }

    if (!apiKeyDoc || !timingSafeEqualHex(presentedHash, apiKeyDoc.apiKeyHash)) {
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

      if (!timingSafeEqualHex(secretKeyHash, apiKeyDoc.secretKeyHash)) {
        res.status(401).json({
          success: false,
          error: 'Invalid API secret',
        });
        return;
      }
    }

    // Check origin if allowedOrigins is set
    const origin = req.headers.origin || req.headers.referer;
    if (!isOriginAllowed(origin, apiKeyDoc.allowedOrigins || [])) {
      res.status(403).json({
        success: false,
        error: 'Origin not allowed',
      });
      return;
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
