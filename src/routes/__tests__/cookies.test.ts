import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner } from '../../test/helpers.js';

const app = createTestApp();

const loginAndCookies = async (email: string) => {
  await registerOwner(app, { email });
  const login = await request(app).post('/api/v1/auth/login').send({
    email,
    password: 'Password123',
  });
  expect(login.status).toBe(200);
  const rawCookies: unknown = login.headers['set-cookie'];
  const cookies: string[] = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [String(rawCookies)] : [];
  const jar = cookies.map((c) => c.split(';')[0]).join('; ');
  const csrf = (cookies.find((c) => c.startsWith('csrf_token=')) || '').split(';')[0].split('=')[1];
  return { login, jar, csrf };
};

describe('cookie session auth', () => {
  it('login issues httpOnly session cookies', async () => {
    const { login } = await loginAndCookies('cookie1@example.com');
    const raw: unknown = login.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
    const access = cookies.find((c) => c.startsWith('accessToken='));
    const refresh = cookies.find((c) => c.startsWith('refreshToken='));
    expect(access).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(cookies.find((c) => c.startsWith('csrf_token='))).toBeTruthy();
  });

  it('cookie alone authenticates; CSRF enforced on mutations', async () => {
    const { jar, csrf } = await loginAndCookies('cookie2@example.com');

    const me = await request(app).get('/api/v1/auth/me').set('Cookie', jar);
    expect(me.status).toBe(200);

    const noCsrf = await request(app)
      .put('/api/v1/auth/profile')
      .set('Cookie', jar)
      .send({ firstName: 'A', lastName: 'B' });
    expect(noCsrf.status).toBe(403);

    const withCsrf = await request(app)
      .put('/api/v1/auth/profile')
      .set('Cookie', jar)
      .set('x-csrf-token', csrf)
      .send({ firstName: 'A', lastName: 'B' });
    expect(withCsrf.status).toBe(200);
  });

  it('logout revokes tokens server-side', async () => {
    const { login, jar, csrf } = await loginAndCookies('cookie3@example.com');
    const oldAccess = login.body.data.tokens.accessToken;

    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', jar)
      .set('x-csrf-token', csrf);
    expect(out.status).toBe(200);

    const revoked = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${oldAccess}`);
    expect(revoked.status).toBe(401);
    expect(revoked.body.error).toBe('Session revoked');
  });
});
