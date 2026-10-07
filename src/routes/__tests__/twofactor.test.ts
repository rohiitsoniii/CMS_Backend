import { describe, it, expect } from 'vitest';
import request from 'supertest';
import speakeasy from 'speakeasy';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader } from '../../test/helpers.js';

const app = createTestApp();

describe('two-factor totp', () => {
  it('setup returns secret; enable with live token; wrong token rejected', async () => {
    const { auth } = await registerOwner(app, { email: 'totp1@example.com' });
    const headers = authHeader(auth!);

    const setup = await request(app).post('/api/v1/two-factor/setup').set(headers).send({});
    expect(setup.status).toBe(200);
    expect(setup.body.success).toBe(true);
    const secret: string = setup.body.data.secret;
    expect(secret).toBeTruthy();

    const bad = await request(app)
      .post('/api/v1/two-factor/enable')
      .set(headers)
      .send({ token: '000000' });
    expect(bad.status).toBe(400);

    const goodToken = speakeasy.totp({ secret, encoding: 'base32' });
    const enabled = await request(app)
      .post('/api/v1/two-factor/enable')
      .set(headers)
      .send({ token: goodToken });
    expect(enabled.status).toBe(200);
    expect(enabled.body.success).toBe(true);

    // Old pre-MFA token is now rejected with MFA_REQUIRED on guarded routes
    const stale = await request(app).get('/api/v1/two-factor/status').set(headers);
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe('MFA_REQUIRED');

    // Fresh TOTP passes the verify step and yields a verified session
    const challenge = speakeasy.totp({ secret, encoding: 'base32' });
    const verified = await request(app)
      .post('/api/v1/two-factor/verify')
      .set(headers)
      .send({ token: challenge });
    expect(verified.status).toBe(200);
    const verifiedToken = verified.body.data.tokens.accessToken;

    const status = await request(app)
      .get('/api/v1/two-factor/status')
      .set('Authorization', `Bearer ${verifiedToken}`);
    expect(status.status).toBe(200);
  });
});
