import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';

const app = createTestApp();

const createContent = async (app: any, auth: any, projectId: string, overrides: any = {}) => {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/content`)
    .set(authHeader(auth))
    .send({ type: 'blog', name: 'Test Post', data: { title: 'Hello' }, ...overrides });
  return res;
};

describe('content lifecycle', () => {
  it('creates, reads, updates, publishes, unpublishes and deletes', async () => {
    const { auth } = await registerOwner(app, { email: 'content1@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'content-proj-1');
    const headers = authHeader(auth!);

    const created = await createContent(app, auth!, projectId);
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    const id: string = created.body.data._id || created.body.data.id;

    const listed = await request(app).get(`/api/v1/projects/${projectId}/content`).set(headers);
    expect(listed.status).toBe(200);
    expect(listed.body.pagination.total).toBe(1);

    const got = await request(app).get(`/api/v1/projects/${projectId}/content/${id}`).set(headers);
    expect(got.status).toBe(200);

    const updated = await request(app)
      .put(`/api/v1/projects/${projectId}/content/${id}`)
      .set(headers)
      .send({ name: 'Renamed Post' });
    expect(updated.status).toBe(200);

    const published = await request(app)
      .post(`/api/v1/projects/${projectId}/content/${id}/publish`)
      .set(headers)
      .send({});
    expect(published.status).toBe(200);

    const unpublished = await request(app)
      .post(`/api/v1/projects/${projectId}/content/${id}/unpublish`)
      .set(headers)
      .send({});
    expect(unpublished.status).toBe(200);

    const deleted = await request(app)
      .delete(`/api/v1/projects/${projectId}/content/${id}`)
      .set(headers);
    expect(deleted.status).toBe(200);

    const gone = await request(app)
      .get(`/api/v1/projects/${projectId}/content/${id}`)
      .set(headers);
    expect(gone.status).toBe(404);
  });

  it('rejects create without type', async () => {
    const { auth } = await registerOwner(app, { email: 'content2@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'content-proj-2');

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/content`)
      .set(authHeader(auth!))
      .send({ name: 'No type' });
    expect(res.status).toBe(400);
  });
});
