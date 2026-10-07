import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { beforeAll, afterEach, afterAll } from 'vitest';

// Test environment — must be set before app modules load
process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
process.env.JWT_SECRET = 'test_jwt_secret_key_32chars_long_abc123';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32chars_xyz789';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.API_KEY_SECRET = 'test_api_key_secret_32chars_long';
process.env.FRONTEND_URL = 'http://localhost:5174';
// No real SMTP in tests — point at a closed port so mail attempts fail
// instantly (ECONNREFUSED) instead of hanging on external timeouts.
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '1';
process.env.SMTP_USER = 'test';
process.env.SMTP_PASS = 'test';

let mongo: MongoMemoryReplSet | undefined;

beforeAll(async () => {
  // Replica set (single node) so multi-write transactions work in tests,
  // matching production (Atlas) semantics.
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
}, 180000);

afterEach(async () => {
  // Clean all collections between tests for isolation
  const collections = mongoose.connection.collections;
  for (const collection of Object.values(collections)) {
    await collection.deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
