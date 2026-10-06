import mongoose from 'mongoose';
import { getRedisClient } from '../config/redis.js';

export const checkMongo = (): string => {
  const state = mongoose.connection.readyState;
  switch (state) {
    case 0: return 'disconnected';
    case 1: return 'connected';
    case 2: return 'connecting';
    case 3: return 'disconnecting';
    default: return 'unknown';
  }
};

export const checkRedis = (): string => {
  const client = getRedisClient();
  if (!client) return 'disconnected';
  return client.status === 'ready' ? 'connected' : client.status;
};

export const getSystemHealth = () => {
  const mongoStatus = checkMongo();
  const redisStatus = checkRedis();

  const isReady = mongoStatus === 'connected' && (redisStatus === 'connected' || redisStatus === 'disconnected');

  return {
    status: isReady ? 'ok' : 'error',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '3.0.1',
    dependencies: {
      mongodb: mongoStatus,
      redis: redisStatus
    }
  };
};
