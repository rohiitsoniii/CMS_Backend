import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, type TestAuth } from '../../test/helpers.js';

const app = createTestApp();

/** Fresh signup (no Stripe subscription) -> project + API key, all via the API. */
async function workspace(email: string, slug: string, permissions = ['content:read', 'content:write']) {
  const { auth } = await registerOwner(app, { email });
  const proj = await request(app).post('/api/v1/projects').set(authHeader(auth!)).send({ name: 'Site', slug });
  const projectId = proj.body.data?.project?._id;
  const key = await request(app).post('/api/v1/auth/api-keys').set(authHeader(auth!)).send({ name: 'server', permissions });
  return { auth: auth as TestAuth, proj, projectId, apiKey: key.body.data.apiKey as string, secret: key.body.data.secretKey as string };
}

describe('free plan works without a Stripe subscription', () => {
  it('a new signup can create its first project, but not more than the Free plan allows', async () => {
    const w = await workspace('free1@example.com', 'free-one');
    expect(w.proj.status).toBe(201);
    const second = await request(app).post('/api/v1/projects').set(authHeader(w.auth)).send({ name: 'Two', slug: 'free-two' });
    expect(second.status).toBe(403);
    expect(second.body.error).toMatch(/limit/i);
  });

  it('accepts a one-word name at signup', async () => {
    const { res } = await registerOwner(app, { email: 'mononym@example.com', name: 'Rohit' });
    expect(res.status).toBe(201);
  });
});

describe('API-only mode (X-API-Key + X-API-Secret)', () => {
  it('manages content end to end and delivers custom types', async () => {
    const w = await workspace('apionly1@example.com', 'api-only-1');
    const key = { 'X-API-Key': w.apiKey, 'X-API-Secret': w.secret };

    const ct = await request(app).post('/api/v1/content-types').set(key).send({
      name: 'Product', fields: [{ name: 'title', label: 'Title', type: 'text' }, { name: 'price', label: 'Price', type: 'number' }],
    });
    expect(ct.status).toBe(201);
    expect(ct.body.data.contentType?.apiId || ct.body.data.apiId).toBe('product');

    const created = await request(app).post(`/api/v1/projects/${w.projectId}/content`).set(key)
      .send({ type: 'product', name: 'Shoe', slug: 'shoe', data: { title: 'Shoe', price: 10 } });
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    expect((await request(app).post(`/api/v1/projects/${w.projectId}/content/${id}/publish`).set(key).send({})).status).toBe(200);

    const listed = await request(app).get(`/api/v1/projects/${w.projectId}/content?type=product`).set(key);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).toContain('Shoe');

    const delivered = await request(app).get('/api/v1/deliver/api-only-1/collections/product').set('X-API-Key', w.apiKey);
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.items).toHaveLength(1);
    expect(delivered.body.data.items[0].data.price).toBe(10);
    const one = await request(app).get('/api/v1/deliver/api-only-1/collections/product/shoe').set('X-API-Key', w.apiKey);
    expect(one.status).toBe(200);
  });

  it('requires the secret, enforces read-only keys and keeps account areas human-only', async () => {
    const w = await workspace('apionly2@example.com', 'api-only-2', ['content:read']);
    const noSecret = await request(app).get(`/api/v1/projects/${w.projectId}/content`).set('X-API-Key', w.apiKey);
    expect(noSecret.status).toBe(401);

    const ro = { 'X-API-Key': w.apiKey, 'X-API-Secret': w.secret };
    expect((await request(app).get(`/api/v1/projects/${w.projectId}/content`).set(ro)).status).toBe(200);
    const write = await request(app).post(`/api/v1/projects/${w.projectId}/content`).set(ro).send({ type: 'blog', name: 'x', data: {} });
    expect(write.status).toBe(403);

    expect((await request(app).get('/api/v1/billing/subscription').set(ro)).status).toBe(403);
    expect((await request(app).post('/api/v1/auth/api-keys').set(ro).send({ name: 'escalate' })).status).toBe(403);
    expect((await request(app).get('/api/v1/auth/me').set(ro)).status).toBe(200);
  });
});

describe('tenant isolation', () => {
  it('the same project slug in two accounts never leaks content through delivery', async () => {
    const a = await workspace('slug-a@example.com', 'shared-slug');
    const b = await workspace('slug-b@example.com', 'shared-slug');
    expect(b.proj.status).toBe(201);
    const post = await request(app).post(`/api/v1/projects/${a.projectId}/content`).set(authHeader(a.auth))
      .send({ type: 'blog', name: 'Secret A', slug: 'secret-a', data: { title: 'Secret A' } });
    await request(app).post(`/api/v1/projects/${a.projectId}/content/${post.body.data._id}/publish`).set(authHeader(a.auth)).send({});

    const asA = await request(app).get('/api/v1/deliver/shared-slug/blogs').set('X-API-Key', a.apiKey);
    expect(JSON.stringify(asA.body)).toContain('secret-a');
    const asB = await request(app).get('/api/v1/deliver/shared-slug/blogs').set('X-API-Key', b.apiKey);
    expect(asB.status).toBe(200);
    expect(JSON.stringify(asB.body)).not.toContain('secret-a');
  });

  it('webhooks are scoped to their account and cannot target private addresses', async () => {
    const a = await workspace('hook-a@example.com', 'hook-a');
    const b = await workspace('hook-b@example.com', 'hook-b');
    const hook = await request(app).post('/api/v1/webhooks').set(authHeader(a.auth))
      .send({ projectId: a.projectId, name: 'h', url: 'https://example.com/hook', events: ['content.published'] });
    expect(hook.status).toBe(201);
    const id = hook.body.data._id;

    expect((await request(app).get(`/api/v1/webhooks/${id}`).set(authHeader(b.auth))).status).toBe(404);
    expect((await request(app).put(`/api/v1/webhooks/${id}`).set(authHeader(b.auth)).send({ url: 'https://evil.example.com' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/webhooks/${id}`).set(authHeader(b.auth))).status).toBe(404);
    const list = await request(app).get(`/api/v1/webhooks?projectId=${a.projectId}`).set(authHeader(b.auth));
    expect(list.body.data).toHaveLength(0);
    // B cannot attach a webhook to A's project either
    const foreign = await request(app).post('/api/v1/webhooks').set(authHeader(b.auth))
      .send({ projectId: a.projectId, name: 'x', url: 'https://example.com/x', events: ['content.published'] });
    expect(foreign.status).toBe(404);

    const ssrf = await request(app).post('/api/v1/webhooks').set(authHeader(a.auth))
      .send({ projectId: a.projectId, name: 'internal', url: 'http://127.0.0.1:27017/', events: ['content.published'] });
    expect(ssrf.status).toBe(400);
  });
});
