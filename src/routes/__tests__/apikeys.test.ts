import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';
import { APIKey } from '../../models/APIKey.js';
import { isOriginAllowed, hashPresentedKey } from '../../middleware/apiKeyAuth.js';

const app = createTestApp();

const createKey = async (app: any, auth: any, body: any = {}) => {
  const res = await request(app)
    .post('/api/v1/auth/api-keys')
    .set(authHeader(auth))
    .send({ name: 'test-key', ...body });
  return res;
};

describe('api key management (hash-only)', () => {
  it('create returns raw key once; list never leaks secrets', async () => {
    const { auth } = await registerOwner(app, { email: 'key1@example.com' });

    const created = await createKey(app, auth!);
    expect(created.status).toBe(201);
    expect(created.body.data.apiKey).toMatch(/^hcms_/);
    expect(created.body.data.secretKey).toMatch(/^hcms_secret_/);

    const stored = await APIKey.findById(created.body.data.id).select('+apiKey +secretKey +apiKeyHash');
    expect(stored?.apiKeyHash).toBe(hashPresentedKey(created.body.data.apiKey));
    expect(stored?.keyPrefix).toBe(created.body.data.apiKey.slice(0, 12));

    const listed = await request(app).get('/api/v1/auth/api-keys').set(authHeader(auth!));
    expect(listed.status).toBe(200);
    const item = listed.body.data.apiKeys[0];
    expect(item.keyPrefix).toBeTruthy();
    expect(item.apiKey).toBeUndefined();
    expect(item.secretKey).toBeUndefined();
    expect(item.apiKeyHash).toBeUndefined();
    expect(item.secretKeyHash).toBeUndefined();
  });

  it('delivery authenticates via hashed lookup', async () => {
    const { auth } = await registerOwner(app, { email: 'key2@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'key-proj');
    expect(projectId).toBeTruthy();

    const created = await createKey(app, auth!);
    const res = await request(app)
      .get('/api/v1/deliver/key-proj/blogs')
      .set('X-API-Key', created.body.data.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects unknown keys and wrong secrets', async () => {
    const { auth } = await registerOwner(app, { email: 'key3@example.com' });
    await createProjectWithRoles(app, auth!, 'key-proj-3');
    const created = await createKey(app, auth!);

    const unknown = await request(app)
      .get('/api/v1/deliver/key-proj-3/blogs')
      .set('X-API-Key', 'hcms_definitely_not_a_real_key');
    expect(unknown.status).toBe(401);

    const badSecret = await request(app)
      .get('/api/v1/deliver/key-proj-3/blogs')
      .set('X-API-Key', created.body.data.apiKey)
      .set('X-API-Secret', 'wrong-secret');
    expect(badSecret.status).toBe(401);

    const goodSecret = await request(app)
      .get('/api/v1/deliver/key-proj-3/blogs')
      .set('X-API-Key', created.body.data.apiKey)
      .set('X-API-Secret', created.body.data.secretKey);
    expect(goodSecret.status).toBe(200);
  });

  it('legacy plaintext rows authenticate once and get backfilled', async () => {
    const { auth } = await registerOwner(app, { email: 'key4@example.com' });
    await createProjectWithRoles(app, auth!, 'key-proj-4');

    const raw = 'hcms_legacy_plaintext_key_12345';
    const legacy = await APIKey.create({
      tenantId: auth!.tenantId,
      name: 'legacy-key',
      apiKey: raw,
      apiKeyHash: 'legacy-placeholder',
      secretKeyHash: 'legacy-placeholder',
      createdBy: auth!.userId,
    });

    const res = await request(app)
      .get('/api/v1/deliver/key-proj-4/blogs')
      .set('X-API-Key', raw);
    expect(res.status).toBe(200);

    const after = await APIKey.findById(legacy._id).select('+apiKeyHash');
    expect(after?.apiKeyHash).toBe(hashPresentedKey(raw));
  });
});

describe('origin allow-list', () => {
  it('matches exact and subdomains, rejects lookalikes', () => {
    const allowed = ['https://app.example.com'];
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
    expect(isOriginAllowed('https://app.example.com', allowed)).toBe(true);
    expect(isOriginAllowed('https://api.app.example.com', allowed)).toBe(true);
    expect(isOriginAllowed('https://evil-app.example.com', allowed)).toBe(false);
    expect(isOriginAllowed('https://app.example.com.evil.com', allowed)).toBe(false);
    expect(isOriginAllowed('not-a-url', allowed)).toBe(false);
    expect(isOriginAllowed('https://x.com', [])).toBe(true);
    expect(isOriginAllowed('https://x.com', ['*'])).toBe(true);
  });
});
