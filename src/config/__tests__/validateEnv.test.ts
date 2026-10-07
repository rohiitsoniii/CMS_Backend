import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateEnv } from '../validateEnv.js';

describe('validateEnv', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.restoreAllMocks();
  });

  it('passes with strong secrets in test env', () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '5001';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.JWT_SECRET = 'a'.repeat(40);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
    process.env.FRONTEND_URL = 'http://localhost:5174';
    process.env.API_KEY_SECRET = 'c'.repeat(40);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    validateEnv();
    expect(exit).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('exits when a required var is missing', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    validateEnv();
    expect(exit).toHaveBeenCalledWith(1);
    expect(err).toHaveBeenCalled();
  });

  it('refuses weak placeholder secrets in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '5000';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.JWT_SECRET = 'your_super_secret_change_me_1234567890';
    process.env.JWT_REFRESH_SECRET = 'd'.repeat(40);
    process.env.FRONTEND_URL = 'http://localhost:5174';
    process.env.API_KEY_SECRET = 'e'.repeat(40);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    validateEnv();
    expect(exit).toHaveBeenCalledWith(1);
    expect(err).toHaveBeenCalled();
  });
});
