import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';

const app = createTestApp();

describe('webhook lifecycle', () => {
  it('creates, lists, reads, updates and deletes a webhook', async () => {
    const { auth } = await registerOwner(app, { email: 'wh1@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'wh-proj-1');
    const headers = authHeader(auth!);

    const created = await request(app)
      .post('/api/v1/webhooks')
      .set(headers)
      .send({ projectId, name: 'Deploy hook', url: 'https://example.com/hook', events: ['content.published'] });
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    const id: string = created.body.data._id;

    const listed = await request(app).get('/api/v1/webhooks').query({ projectId }).set(headers);
    expect(listed.status).toBe(200);
    expect(listed.body.data.length).toBe(1);

    const got = await request(app).get(`/api/v1/webhooks/${id}`).set(headers);
    expect(got.status).toBe(200);
    expect(got.body.data.name).toBe('Deploy hook');

    const updated = await request(app)
      .put(`/api/v1/webhooks/${id}`)
      .set(headers)
      .send({ name: 'Deploy hook v2' });
    expect(updated.status).toBe(200);

    const deleted = await request(app).delete(`/api/v1/webhooks/${id}`).set(headers);
    expect(deleted.status).toBe(200);

    const gone = await request(app).get(`/api/v1/webhooks/${id}`).set(headers);
    expect(gone.status).toBe(404);
  });

  it('rejects invalid webhook payloads', async () => {
    const { auth } = await registerOwner(app, { email: 'wh2@example.com' });

    const res = await request(app)
      .post('/api/v1/webhooks')
      .set(authHeader(auth!))
      .send({ projectId: 'nope', name: '', url: 'notaurl', events: [] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
