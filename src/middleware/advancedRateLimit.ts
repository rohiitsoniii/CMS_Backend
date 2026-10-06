import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
}

const blockedIPs = new Set<string>();

export const advancedRateLimit = (config: RateLimitConfig) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = config.keyGenerator ? config.keyGenerator(req) : req.ip || 'unknown';
      
      // Check if IP is blocked
      if (blockedIPs.has(req.ip || '')) {
        return res.status(429).json({ error: 'IP blocked due to excessive requests' });
      }

      const redisKey = `ratelimit:${key}`;
      const current = await redis.incr(redisKey);
      
      if (current === 1) {
        await redis.expire(redisKey, Math.floor(config.windowMs / 1000));
      }

      const ttl = await redis.ttl(redisKey);
      
      res.setHeader('X-RateLimit-Limit', config.maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, config.maxRequests - current).toString());
      res.setHeader('X-RateLimit-Reset', (Date.now() + ttl * 1000).toString());

      if (current > config.maxRequests) {
        // Auto-block if exceeds 3x the limit
        if (current > config.maxRequests * 3) {
          blockedIPs.add(req.ip || '');
          setTimeout(() => blockedIPs.delete(req.ip || ''), 3600000); // Unblock after 1 hour
        }
        
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: ttl
        });
      }

      next();
    } catch (error) {
      next();
    }
  };
};

// Per-user rate limiting
export const userRateLimit = advancedRateLimit({
  windowMs: 60000, // 1 minute
  maxRequests: 100,
  keyGenerator: (req) => `user:${req.user?.id || req.ip}`
});

// Per-API-key rate limiting
export const apiKeyRateLimit = advancedRateLimit({
  windowMs: 60000,
  maxRequests: 1000,
  keyGenerator: (req) => `apikey:${req.headers['x-api-key'] || req.ip}`
});

// Per-IP rate limiting
export const ipRateLimit = advancedRateLimit({
  windowMs: 60000,
  maxRequests: 50,
  keyGenerator: (req) => `ip:${req.ip}`
});

// Endpoint-specific rate limiting
export const endpointRateLimit = (endpoint: string, maxRequests: number) => {
  return advancedRateLimit({
    windowMs: 60000,
    maxRequests,
    keyGenerator: (req) => `endpoint:${endpoint}:${req.user?.id || req.ip}`
  });
};
