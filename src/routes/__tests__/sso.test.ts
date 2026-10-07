import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner } from '../../test/helpers.js';

const app = createTestApp();

describe('sso auth guard', () => {
  it('POST /sso/google/link without token → 401 (not 500)', async () => {
    const res = await request(app)
      .post('/api/v1/sso/google/link')
      .send({ code: 'dummy-code' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('POST /sso/google/unlink without token → 401 (not 500)', async () => {
    const res = await request(app).post('/api/v1/sso/google/unlink').send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /sso/status without token → 401', async () => {
    const res = await request(app).get('/api/v1/sso/status');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /sso/status with token → 200', async () => {
    const { auth } = await registerOwner(app, { email: 'sso-status@example.com' });
    const res = await request(app)
      .get('/api/v1/sso/status')
      .set('Authorization', `Bearer ${auth!.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.google).toBe('boolean');
  });

  it('POST /two-factor/verify accepts pre-MFA temp token (not 403 MFA_REQUIRED)', async () => {
    const { auth } = await registerOwner(app, { email: 'sso-mfa@example.com' });
    // Simulate the login pre-MFA token: access token with mfaVerified=false.
    // auth.accessToken from register is exactly that shape, and the user has
    // no 2FA enabled so verify should reach the controller (400 invalid code,
    // not 403 MFA_REQUIRED and not 401).
    const res = await request(app)
      .post('/api/v1/two-factor/verify')
      .set('Authorization', `Bearer ${auth!.accessToken}`)
      .send({ token: '000000' });
    expect([400, 200]).toContain(res.status);
    expect(res.body.success).toBeDefined();
    if (res.status === 403) {
      expect(res.body.code).not.toBe('MFA_REQUIRED');
    }
  });
});
