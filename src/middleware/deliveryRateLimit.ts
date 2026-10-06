import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

/**
 * Per-Project Delivery Rate Limiter
 *
 * Protects the public delivery API from DDoS and abusive tenants.
 * Limits are keyed by project slug so one tenant cannot affect others.
 *
 * Tiers:
 *  - Default (free): 120 requests / 60s
 *  - Rate limit response: 429 with Retry-After header
 */

/**
 * Express middleware that rate-limits delivery requests per project.
 * Uses the `projectSlug` route param as the unique key.
 */
export const deliveryRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 120,             // requests per window per project
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,

    // Key by project slug so tenants are isolated from each other
    keyGenerator: (req: Request): string => {
        return `delivery:${req.params.projectSlug || req.ip}`;
    },

    handler: (req: Request, res: Response) => {
        res.status(429).json({
            success: false,
            error: 'Too Many Requests',
            message: 'You have exceeded the delivery API rate limit. Please reduce your request frequency.',
            retryAfter: Math.ceil(60), // seconds
            docs: 'Contact support to increase your rate limit for your plan.',
        });
    },

    skip: (req: Request): boolean => {
        // Skip rate limiting in test environment
        return process.env.NODE_ENV === 'test';
    },
});

/**
 * Stricter limit for heavy endpoints like /all
 */
export const deliveryHeavyRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // The /all endpoint is more expensive
    standardHeaders: true,
    legacyHeaders: false,

    keyGenerator: (req: Request): string => {
        return `delivery-heavy:${req.params.projectSlug || req.ip}`;
    },

    handler: (req: Request, res: Response) => {
        res.status(429).json({
            success: false,
            error: 'Too Many Requests',
            message: 'The /all endpoint is rate-limited to 30 requests/min. Use individual endpoints for higher frequency.',
        });
    },
});

/**
 * Simple in-memory response cache for delivery endpoints.
 * Key: projectSlug + locale. TTL: 60 seconds.
 */
interface CacheEntry {
    data: any;
    expiry: number;
}

class DeliveryCache {
    private cache: Map<string, CacheEntry> = new Map();
    private readonly TTL_MS = 60_000; // 60 seconds

    get(key: string): any | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }

    set(key: string, data: any): void {
        this.cache.set(key, {
            data,
            expiry: Date.now() + this.TTL_MS,
        });
    }

    invalidate(projectSlug: string): void {
        // Remove all cache entries for this project
        for (const key of this.cache.keys()) {
            if (key.startsWith(`${projectSlug}:`)) {
                this.cache.delete(key);
            }
        }
    }

    buildKey(projectSlug: string, endpoint: string, locale?: string): string {
        return `${projectSlug}:${endpoint}:${locale || 'en'}`;
    }
}

export const deliveryCache = new DeliveryCache();

/**
 * Cache middleware factory for delivery endpoints.
 */
export function withDeliveryCache(endpointName: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const { projectSlug } = req.params;
        const locale = (req.query.lang || req.query.locale) as string;
        const cacheKey = deliveryCache.buildKey(projectSlug, endpointName, locale);

        const cached = deliveryCache.get(cacheKey);
        if (cached) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, max-age=60');
            res.json(cached);
            return;
        }

        // Patch res.json to cache the response before sending
        const originalJson = res.json.bind(res);
        res.json = (body: any) => {
            if (res.statusCode === 200) {
                deliveryCache.set(cacheKey, body);
            }
            res.setHeader('X-Cache', 'MISS');
            return originalJson(body);
        };

        next();
    };
}
