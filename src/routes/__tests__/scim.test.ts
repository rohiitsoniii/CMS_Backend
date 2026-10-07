import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader } from '../../test/helpers.js';
import { User } from '../../models/User.js';

const app = createTestApp();
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';

describe('SCIM 2.0 provisioning', () => {
  it('rejects requests without (or with invalid) token using the SCIM Error schema', async () => {
    const noToken = await request(app).get('/api/v1/scim/v2/Users');
    expect(noToken.status).toBe(401);
    expect(noToken.body.schemas).toEqual([ERROR_SCHEMA]);
    expect(noToken.body.status).toBe('401');

    const badToken = await request(app)
      .get('/api/v1/scim/v2/Users')
      .set('Authorization', 'Bearer bogus-token');
    expect(badToken.status).toBe(401);
    expect(badToken.body.schemas).toEqual([ERROR_SCHEMA]);
  });

  it('full lifecycle: create -> list -> get -> patch deactivate -> login fails -> delete (soft) -> 204, and rotation invalidates the old token', async () => {
    const { auth } = await registerOwner(app, { email: 'scim-owner@example.com' });
    expect(auth).toBeDefined();

    // Rotate (mint) a SCIM token via the admin endpoint.
    const minted = await request(app)
      .post('/api/v1/admin/scim/token')
      .set(authHeader(auth!));
    expect(minted.status).toBe(201);
    const token: string = minted.body.data.token;
    expect(typeof token).toBe('string');
    const scim = { Authorization: `Bearer ${token}` };

    // Create
    const created = await request(app)
      .post('/api/v1/scim/v2/Users')
      .set(scim)
      .send({
        schemas: [USER_SCHEMA],
        userName: 'scim.user@example.com',
        name: { givenName: 'Scim', familyName: 'User' },
        emails: [{ primary: true, value: 'scim.user@example.com' }],
        roles: [{ value: 'editor' }],
        active: true,
      });
    expect(created.status).toBe(201);
    expect(created.body.schemas).toEqual([USER_SCHEMA]);
    expect(created.body.userName).toBe('scim.user@example.com');
    const scimUserId: string = created.body.id;
    expect(scimUserId).toBeTruthy();

    // Give the provisioned user a known password so we can exercise login later.
    const provisioned = await User.findById(scimUserId);
    expect(provisioned).toBeTruthy();
    provisioned!.password = 'ScimPass123';
    await provisioned!.save();

    // List (tenant owner + provisioned user)
    const listed = await request(app).get('/api/v1/scim/v2/Users').set(scim);
    expect(listed.status).toBe(200);
    expect(listed.body.totalResults).toBe(2);
    expect(listed.body.Resources.map((r: any) => r.userName)).toContain('scim.user@example.com');

    // Filtered list
    const filtered = await request(app)
      .get('/api/v1/scim/v2/Users')
      .query({ filter: 'userName eq "scim.user@example.com"' })
      .set(scim);
    expect(filtered.status).toBe(200);
    expect(filtered.body.totalResults).toBe(1);

    // Get by id
    const fetched = await request(app).get(`/api/v1/scim/v2/Users/${scimUserId}`).set(scim);
    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(scimUserId);

    // PATCH deactivate
    const patched = await request(app)
      .patch(`/api/v1/scim/v2/Users/${scimUserId}`)
      .set(scim)
      .send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Replace', path: 'active', value: false }] });
    expect(patched.status).toBe(200);
    expect(patched.body.active).toBe(false);

    // Deactivated user must fail login.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'scim.user@example.com', password: 'ScimPass123' });
    expect(login.status).toBe(403);

    // DELETE -> 204 soft-deactivate, never hard-delete.
    const deleted = await request(app).delete(`/api/v1/scim/v2/Users/${scimUserId}`).set(scim);
    expect(deleted.status).toBe(204);
    const stillThere = await User.findById(scimUserId);
    expect(stillThere).toBeTruthy();
    expect(stillThere!.isActive).toBe(false);

    // Rotate again: old token dies, new token works.
    const rotated = await request(app)
      .post('/api/v1/admin/scim/token')
      .set(authHeader(auth!));
    expect(rotated.status).toBe(201);
    const newToken: string = rotated.body.data.token;
    expect(newToken).not.toBe(token);

    const stale = await request(app).get('/api/v1/scim/v2/Users').set(scim);
    expect(stale.status).toBe(401);
    expect(stale.body.schemas).toEqual([ERROR_SCHEMA]);

    const fresh = await request(app)
      .get('/api/v1/scim/v2/Users')
      .set({ Authorization: `Bearer ${newToken}` });
    expect(fresh.status).toBe(200);

    // Revoke: new token dies too.
    const revoked = await request(app)
      .delete('/api/v1/admin/scim/token')
      .set(authHeader(auth!));
    expect(revoked.status).toBe(200);
    const afterRevoke = await request(app)
      .get('/api/v1/scim/v2/Users')
      .set({ Authorization: `Bearer ${newToken}` });
    expect(afterRevoke.status).toBe(401);
  });
});
