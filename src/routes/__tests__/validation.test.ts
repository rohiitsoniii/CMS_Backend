import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';

const app = createTestApp();

describe('request validation', () => {
  it('content create requires type and name', async () => {
    const { auth } = await registerOwner(app, { email: 'val1@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'val-proj-1');

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/content`)
      .set(authHeader(auth!))
      .send({ name: 'No type' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Validation failed');
  });

  it('content :id params must be ObjectIds', async () => {
    const { auth } = await registerOwner(app, { email: 'val2@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'val-proj-2');

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/content/not-an-id`)
      .set(authHeader(auth!));
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('webhook create requires name, url and events', async () => {
    const { auth } = await registerOwner(app, { email: 'val3@example.com' });

    const res = await request(app)
      .post('/api/v1/webhooks')
      .set(authHeader(auth!))
      .send({ projectId: 'x', name: '', url: 'not-a-url', events: [] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('billing subscription rejects bad cycle', async () => {
    const { auth } = await registerOwner(app, { email: 'val4@example.com' });

    const res = await request(app)
      .post('/api/v1/billing/subscription')
      .set(authHeader(auth!))
      .send({ planId: 'plan_x', billingCycle: 'decade' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('delivery rejects malformed slugs and empty chat', async () => {
    const { auth } = await registerOwner(app, { email: 'val6@example.com' });
    await createProjectWithRoles(app, auth!, 'val-proj-6');
    const keyRes = await request(app)
      .post('/api/v1/auth/api-keys')
      .set(authHeader(auth!))
      .send({ name: 'val-key' });
    const headers = { 'X-API-Key': keyRes.body.data.apiKey };

    const badSlug = await request(app).get('/api/v1/deliver/INVALID_SLUG_XYZ/blogs').set(headers);
    expect(badSlug.status).toBe(400);

    const emptyChat = await request(app)
      .post('/api/v1/deliver/val-proj-6/chat')
      .set(headers)
      .send({ message: '' });
    expect(emptyChat.status).toBe(400);
  });

  it('media folder create requires a name', async () => {
    const { auth } = await registerOwner(app, { email: 'val5@example.com' });

    const res = await request(app)
      .post('/api/v1/admin/media/folders')
      .set(authHeader(auth!))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
