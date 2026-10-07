import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles, DEFAULT_PASSWORD } from '../../test/helpers.js';
import { User } from '../../models/User.js';

const app = createTestApp();

describe('gdpr data-subject rights', () => {
  it('export requires auth and returns own data sections', async () => {
    const anon = await request(app).get('/api/v1/gdpr/export');
    expect(anon.status).toBe(401);

    const { auth } = await registerOwner(app, { email: 'gdpr1@example.com' });
    const res = await request(app).get('/api/v1/gdpr/export').set(authHeader(auth!));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.email).toBe('gdpr1@example.com');
    expect(res.body.data.profile).not.toHaveProperty('password');
    expect(res.body.data).toHaveProperty('projects');
    expect(res.body.data).toHaveProperty('teamMemberships');
    expect(res.body.data).toHaveProperty('generatedAt');
  });

  it('erase rejects wrong password', async () => {
    const { auth } = await registerOwner(app, { email: 'gdpr2@example.com' });
    const res = await request(app)
      .post('/api/v1/gdpr/erase')
      .set(authHeader(auth!))
      .send({ password: 'WrongPass999' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('erase scrubs PII, revokes access, blocks login', async () => {
    const email = 'gdpr3@example.com';
    const { auth } = await registerOwner(app, { email });

    const res = await request(app)
      .post('/api/v1/gdpr/erase')
      .set(authHeader(auth!))
      .send({ password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const scrubbed = await User.findById(auth!.userId);
    expect(scrubbed?.isActive).toBe(false);
    expect(scrubbed?.email).toMatch(/deleted_.*@deleted\.local/);
    expect(scrubbed?.firstName).toBe('Deleted');

    const login = await request(app).post('/api/v1/auth/login').send({ email, password: DEFAULT_PASSWORD });
    expect(login.status).not.toBe(200);
  });

  it('blocks sole owner of a workspace with projects', async () => {
    const { auth } = await registerOwner(app, { email: 'gdpr4@example.com' });
    await createProjectWithRoles(app, auth!, 'gdpr-proj');

    const res = await request(app)
      .post('/api/v1/gdpr/erase')
      .set(authHeader(auth!))
      .send({ password: DEFAULT_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.blockers.projects).toBe(1);
  });
});
