import Redis from 'ioredis';
import { config } from './index.js';

let redisClient: Redis | null = null;

export const connectRedis = async (): Promise<Redis> => {
  if (redisClient) {
    return redisClient;
  }

  try {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          console.warn('⚠️ Redis connection failed, continuing without cache');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis Connected');
    });

    redisClient.on('error', (err) => {
      console.error('❌ Redis connection error:', err.message);
    });

    redisClient.on('close', () => {
      console.warn('⚠️ Redis connection closed');
    });

    return redisClient;
  } catch (error) {
    console.error('❌ Error connecting to Redis:', error);
    throw error;
  }
};

export const getRedisClient = (): Redis | null => {
  return redisClient;
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('Redis disconnected');
  }
};

// Cache helper functions
export const cacheGet = async (key: string): Promise<string | null> => {
  if (!redisClient) return null;
  try {
    return await redisClient.get(key);
  } catch {
    return null;
  }
};

export const cacheSet = async (
  key: string,
  value: string,
  ttlSeconds: number = 300
): Promise<void> => {
  if (!redisClient) return;
  try {
    await redisClient.setex(key, ttlSeconds, value);
  } catch (error) {
    console.error('Cache set error:', error);
  }
};

export const cacheDelete = async (key: string): Promise<void> => {
  if (!redisClient) return;
  try {
    await redisClient.del(key);
  } catch (error) {
    console.error('Cache delete error:', error);
  }
};

export const cacheDeletePattern = async (pattern: string): Promise<void> => {
  if (!redisClient) return;
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } catch (error) {
    console.error('Cache delete pattern error:', error);
  }
};
