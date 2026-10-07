import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner } from '../../test/helpers.js';

const app = createTestApp();

describe('auth session', () => {
  it('refreshes tokens', async () => {
    const { auth } = await registerOwner(app, { email: 'refresh@example.com' });
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: auth!.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
  });

  it('rejects refresh without token', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('GET /me requires auth and returns profile with it', async () => {
    const anon = await request(app).get('/api/v1/auth/me');
    expect(anon.status).toBe(401);

    const { auth } = await registerOwner(app, { email: 'me@example.com' });
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${auth!.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('me@example.com');
  });
});
