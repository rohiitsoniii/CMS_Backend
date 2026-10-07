import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';

const app = createTestApp();

describe('team invites', () => {
  it('rejects invite without email', async () => {
    const { auth } = await registerOwner(app, { email: 'inv1@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'inv-proj-1');

    const res = await request(app)
      .post('/api/v1/team/invite')
      .set(authHeader(auth!))
      .send({ projectId });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('invites once, rejects duplicate, accepts via token', async () => {
    const { auth } = await registerOwner(app, { email: 'inv2@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'inv-proj-2');

    const first = await request(app)
      .post('/api/v1/team/invite')
      .set(authHeader(auth!))
      .send({ projectId, email: 'mate@example.com', name: 'Mate', role: 'editor' });
    expect(first.status).toBe(201);
    expect(first.body.success).toBe(true);

    const dupe = await request(app)
      .post('/api/v1/team/invite')
      .set(authHeader(auth!))
      .send({ projectId, email: 'mate@example.com', name: 'Mate', role: 'editor' });
    expect(dupe.status).toBe(400);
    expect(dupe.body.success).toBe(false);
  });
});
