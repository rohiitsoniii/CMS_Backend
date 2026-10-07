import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner } from '../../test/helpers.js';

const app = createTestApp();

describe('auth register/login', () => {
  it('rejects invalid registration payload with unified envelope', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('registers a tenant owner and returns tokens', async () => {
    const { res, auth } = await registerOwner(app, { email: 'owner1@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(auth?.accessToken).toBeTruthy();
    expect(auth?.refreshToken).toBeTruthy();
  });

  it('rejects duplicate email registration', async () => {
    await registerOwner(app, { email: 'dupe@example.com' });
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Another User',
      email: 'dupe@example.com',
      password: 'Password123',
    });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('logs in with valid credentials', async () => {
    await registerOwner(app, { email: 'login@example.com' });
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'login@example.com',
      password: 'Password123',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
  });

  it('rejects wrong password without revealing reason', async () => {
    await registerOwner(app, { email: 'wrongpass@example.com' });
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'wrongpass@example.com',
      password: 'WrongPass999',
    });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
