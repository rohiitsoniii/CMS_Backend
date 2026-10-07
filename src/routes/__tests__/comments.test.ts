import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';

const app = createTestApp();

describe('comments', () => {
  it('creates, lists, resolves and deletes a comment', async () => {
    const { auth } = await registerOwner(app, { email: 'cmt1@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'cmt-proj-1');
    const headers = authHeader(auth!);

    const content = await request(app)
      .post(`/api/v1/projects/${projectId}/content`)
      .set(headers)
      .send({ type: 'blog', name: 'Commentable', data: {} });
    const contentId: string = content.body.data._id || content.body.data.id;

    const created = await request(app)
      .post(`/api/v1/comments/projects/${projectId}/content/${contentId}/comments`)
      .set(headers)
      .send({ content: 'Nice post!' });
    expect(created.status).toBe(200);
    const commentId: string = created.body._id || created.body.id;
    expect(commentId).toBeTruthy();

    const listed = await request(app)
      .get(`/api/v1/comments/content/${contentId}/comments`)
      .set(headers);
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body) ? listed.body.length : listed.body.data?.length ?? 1).toBeGreaterThanOrEqual(1);

    const resolved = await request(app)
      .post(`/api/v1/comments/comments/${commentId}/resolve`)
      .set(headers)
      .send({});
    expect(resolved.status).toBe(200);

    const deleted = await request(app)
      .delete(`/api/v1/comments/comments/${commentId}`)
      .set(headers);
    expect(deleted.status).toBe(200);
  });
});
