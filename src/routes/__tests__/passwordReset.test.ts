import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, DEFAULT_PASSWORD } from '../../test/helpers.js';
import { User } from '../../models/User.js';

const app = createTestApp();

describe('admin password reset', () => {
  it('rejects invalid email with unified validation envelope', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns generic success for unknown email (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('full flow: forgot -> token stored hashed -> reset -> login with new password', async () => {
    const email = 'resetme@example.com';
    await registerOwner(app, { email });

    const forgot = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email });
    expect(forgot.status).toBe(200);
    expect(forgot.body.success).toBe(true);

    // Token hash must be stored; raw token must NOT be stored
    const userAfterForgot = await User.findOne({ email });
    expect(userAfterForgot?.passwordResetToken).toBeTruthy();
    expect(userAfterForgot?.passwordResetToken).toHaveLength(64);
    expect(userAfterForgot?.passwordResetExpires?.getTime()).toBeGreaterThan(Date.now());

    // Simulate the emailed raw token: set a known one the same way the controller does
    const rawToken = crypto.randomBytes(32).toString('hex');
    userAfterForgot!.passwordResetToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    userAfterForgot!.passwordResetExpires = new Date(Date.now() + 3600000);
    await userAfterForgot!.save({ validateBeforeSave: false });

    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'NewPass123' });
    expect(reset.status).toBe(200);
    expect(reset.body.success).toBe(true);

    // Old password rejected, new password works, token is single-use
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: DEFAULT_PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'NewPass123' });
    expect(newLogin.status).toBe(200);

    const reuse = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'Another123' });
    expect(reuse.status).toBe(400);
    expect(reuse.body.success).toBe(false);
  });

  it('rejects invalid/expired token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'bogus-token', password: 'NewPass123' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects weak new password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'bogus-token', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
