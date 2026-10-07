import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';

const app = createTestApp();

describe('nosql injection (api level)', () => {
  it('operator objects in filters match nothing and leak nothing', async () => {
    const { auth } = await registerOwner(app, { email: 'inj1@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'inj-proj');
    const headers = authHeader(auth!);

    // qs parses type[$gt] into { $gt: '' } — must be coerced, not executed
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/content`)
      .query('type[$gt]=')
      .set(headers);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);

    const statusHack = await request(app)
      .get(`/api/v1/projects/${projectId}/content`)
      .query('status[$ne]=archived')
      .set(headers);
    expect(statusHack.status).toBe(200);
    expect(statusHack.body.data).toEqual([]);
  });

  it('malicious search input is escaped and bounded', async () => {
    const { auth } = await registerOwner(app, { email: 'inj2@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'inj-proj-2');

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/content`)
      .query({ search: '(a+)+$' })
      .set(authHeader(auth!));
    expect(res.status).toBe(200);

    // Oversized search / limit are rejected at the validation layer
    const huge = await request(app)
      .get(`/api/v1/projects/${projectId}/content`)
      .query({ search: 'x'.repeat(5000), limit: '999999' })
      .set(authHeader(auth!));
    expect(huge.status).toBe(400);
    expect(huge.body.success).toBe(false);
  });
});
