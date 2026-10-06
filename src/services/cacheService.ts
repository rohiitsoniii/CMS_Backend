import { cacheGet, cacheSet, cacheDelete, cacheDeletePattern } from '../config/redis.js';

export class CacheService {
  /**
   * Generates a deterministic cache key based on the request tenant, project, and path.
   */
  static generateKey(tenantId: string, projectSlug: string, path: string, query: any = {}): string {
    const queryStr = Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : '';
    return `cache:${tenantId}:${projectSlug}:${path}${queryStr}`;
  }

  static async get(key: string): Promise<any | null> {
    const data = await cacheGet(key);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return data; // Return string if not JSON
    }
  }

  static async set(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    await cacheSet(key, payload, ttlSeconds);
  }

  static async del(key: string): Promise<void> {
    await cacheDelete(key);
  }

  /**
   * Invalidate all cache entries for a specific project
   */
  static async invalidateProject(tenantId: string, projectSlug: string): Promise<void> {
    await cacheDeletePattern(`cache:${tenantId}:${projectSlug}:*`);
  }

  /**
   * Invalidate all cache entries for an entire tenant
   */
  static async invalidateTenant(tenantId: string): Promise<void> {
    await cacheDeletePattern(`cache:${tenantId}:*`);
  }
}
