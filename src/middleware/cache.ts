import { Request, Response, NextFunction } from 'express';
import { CacheService } from '../services/cacheService.js';

/**
 * Middleware that caches successful GET requests
 * @param ttlSeconds Time-to-live in seconds (default 300 / 5 minutes)
 */
export const cacheResponse = (ttlSeconds: number = 300) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    try {
      // Must have tenant contextualized
      const tenantId = req.tenantId || (req.tenant ? req.tenant._id.toString() : 'global');
      const projectSlug = req.params.projectSlug || 'default';
      
      const key = CacheService.generateKey(tenantId, projectSlug, req.path, req.query);
      
      const cachedResponse = await CacheService.get(key);
      if (cachedResponse) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Content-Type', 'application/json');
        res.send(cachedResponse);
        return;
      }
      
      res.setHeader('X-Cache', 'MISS');

      // Override res.json to capture response body
      const originalJson = res.json;
      res.json = function(body) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
           CacheService.set(key, body, ttlSeconds).catch(err => console.error('Cache Set Error', err));
        }
        return originalJson.call(this, body);
      };

      next();
    } catch (error) {
      // If cache fails, continue to handler
      console.error('Cache Middleware Error:', error);
      next();
    }
  };
};
