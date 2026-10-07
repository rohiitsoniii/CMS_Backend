import { describe, it, expect } from 'vitest';
import { redactForLog } from '../errorHandler.js';

describe('redactForLog', () => {
  it('redacts passwords, tokens and secrets (any casing/separator)', () => {
    const out = redactForLog({
      email: 'a@b.com',
      password: 'hunter2',
      currentPassword: 'x',
      api_key: 'k',
      'X-API-Secret': 's',
      authorization: 'Bearer t',
      nested: { refreshToken: 'r', ok: 1 },
    }) as Record<string, unknown>;
    expect(out.email).toBe('a@b.com');
    expect(out.password).toBe('[REDACTED]');
    expect(out.currentPassword).toBe('[REDACTED]');
    expect(out.api_key).toBe('[REDACTED]');
    expect(out['X-API-Secret']).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
    expect((out.nested as any).refreshToken).toBe('[REDACTED]');
    expect((out.nested as any).ok).toBe(1);
  });

  it('caps size and depth, handles buffers', () => {
    expect(redactForLog('x'.repeat(5000))).toMatch(/\[truncated\]$/);
    expect(redactForLog(Buffer.alloc(10))).toBe('[buffer 10 bytes]');
    const deep: any = { a: { b: { c: { d: { e: 1 } } } } };
    expect(JSON.stringify(redactForLog(deep))).toContain('depth-limit');
  });
});
