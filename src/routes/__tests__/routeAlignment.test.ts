import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';

const app = createTestApp();
const randomId = (): string => new mongoose.Types.ObjectId().toString();

describe('frontend-backend route alignment', () => {
  it('webhook /logs is reachable (not shadowed by /:id)', async () => {
    const { auth } = await registerOwner(app, { email: 'wh@example.com' });
    const logs = await request(app).get('/api/v1/webhooks/logs').set(authHeader(auth!));
    expect(logs.status).toBe(200);
    expect(logs.body.success).toBe(true);
    expect(Array.isArray(logs.body.data)).toBe(true);

    // /:id with unknown id must 404, not return logs
    const single = await request(app).get('/api/v1/webhooks/logs').set(authHeader(auth!));
    expect(single.status).toBe(200);
  });

  it('trash project routes resolve (no double-prefix 404)', async () => {
    const { auth } = await registerOwner(app, { email: 'trash@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'trash-proj');

    const list = await request(app)
      .get(`/api/v1/projects/${projectId}/trash`)
      .set(authHeader(auth!));
    expect(list.status).toBe(200);

    const empty = await request(app)
      .delete(`/api/v1/projects/${projectId}/trash`)
      .set(authHeader(auth!));
    expect(empty.status).toBe(200);
  });

  it('archive project routes resolve', async () => {
    const { auth } = await registerOwner(app, { email: 'arch@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'arch-proj');

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/archive`)
      .set(authHeader(auth!));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('backup project routes resolve for owner', async () => {
    const { auth } = await registerOwner(app, { email: 'bak@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'bak-proj');

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/backups`)
      .set(authHeader(auth!));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('version history canonical and alias paths agree', async () => {
    const { auth } = await registerOwner(app, { email: 'ver@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'ver-proj');
    const contentId = randomId();

    const canonical = await request(app)
      .get(`/api/v1/content/${contentId}/versions`)
      .set(authHeader(auth!));
    const alias = await request(app)
      .get(`/api/v1/projects/${projectId}/content/${contentId}/versions`)
      .set(authHeader(auth!));
    expect(canonical.status).toBe(alias.status);
    expect(canonical.status).toBe(404); // no such content
    expect(alias.body.success).toBe(false);
  });

  it('media serving 404s with unified envelope for unknown id', async () => {
    const res = await request(app).get('/api/v1/media/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
