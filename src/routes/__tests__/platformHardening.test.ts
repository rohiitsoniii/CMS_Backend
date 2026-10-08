import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';
import { withJobLock } from '../../utils/jobLock.js';
import { isPrivateIp, assertPublicUrl, safeGet } from '../../utils/safeFetch.js';
import { User } from '../../models/User.js';
import { Project } from '../../models/index.js';
import { endUserLink } from '../../services/endUserLinks.js';

const app = createTestApp();

describe('job lock', () => {
  it('lets only one runner hold a lock at a time', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const job = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 50));
      concurrent--;
      return true;
    };
    // Simulate two instances by acquiring the same lock concurrently
    const results = await Promise.all([withJobLock('test-lock', 10_000, job), withJobLock('test-lock', 10_000, job)]);
    expect(maxConcurrent).toBe(1);
    expect(results.filter((r) => r === true).length).toBeGreaterThanOrEqual(1);
    // Released afterwards
    expect(await withJobLock('test-lock', 10_000, async () => 'again')).toBe('again');
  });
});

describe('SSRF protection', () => {
  it('classifies private and public addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '100.64.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('rejects internal URLs before connecting', async () => {
    expect(() => assertPublicUrl('http://localhost:5000/admin')).toThrow();
    expect(() => assertPublicUrl('http://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => assertPublicUrl('file:///etc/passwd')).toThrow();
    expect(() => assertPublicUrl('https://user:pass@example.com')).toThrow();
    expect(assertPublicUrl('https://example.com/page').host).toBe('example.com');
    await expect(safeGet('http://127.0.0.1:1/')).rejects.toThrow(/Private IP/);
  });
});

describe('backups', () => {
  const dir = path.join(process.cwd(), 'backups');
  // Other test files share this folder and run in parallel — only remove our own files
  const created: string[] = [];
  afterEach(async () => {
    for (const f of created.splice(0)) await fs.unlink(path.join(dir, f)).catch(() => undefined);
  });

  it("cleanup only removes the caller's own old backups", async () => {
    const a = await registerOwner(app, { email: 'bk-a@example.com' });
    const b = await registerOwner(app, { email: 'bk-b@example.com' });
    await createProjectWithRoles(app, a.auth!, 'bk-a');
    await createProjectWithRoles(app, b.auth!, 'bk-b');

    const ba = await request(app).post('/api/v1/backups').set(authHeader(a.auth!)).send({});
    const bb = await request(app).post('/api/v1/backups').set(authHeader(b.auth!)).send({});
    expect(ba.status).toBe(201);
    expect(bb.status).toBe(201);
    const old = new Date(Date.now() - 40 * 86_400_000);
    for (const res of [ba, bb]) {
      const name = res.body.data.backup.filename;
      created.push(name);
      await fs.utimes(path.join(dir, name), old, old);
    }

    const cleaned = await request(app).post('/api/v1/backups/cleanup').set(authHeader(a.auth!)).send({ daysToKeep: 30 });
    expect(cleaned.status).toBe(200);
    expect(cleaned.body.data.deletedCount).toBe(1);
    const left = await fs.readdir(dir);
    expect(left).toContain(bb.body.data.backup.filename);
    expect(left).not.toContain(ba.body.data.backup.filename);
  });
});

describe('billing permissions', () => {
  it('lets owners through but blocks editors from managing billing', async () => {
    const { auth } = await registerOwner(app, { email: 'bill-owner@example.com' });
    // Owner reaches the Stripe guard (no key configured in tests → 503)
    const owner = await request(app).post('/api/v1/billing/subscription/cancel').set(authHeader(auth!)).send({});
    expect(owner.status).toBe(503);

    await User.updateOne({ _id: auth!.userId }, { role: 'editor', permissions: ['content:read'] });
    const editor = await request(app).post('/api/v1/billing/subscription/cancel').set(authHeader(auth!)).send({});
    expect(editor.status).toBe(403);
  });
});

describe('SSO', () => {
  it('reports provider status and refuses unconfigured providers', async () => {
    const { auth } = await registerOwner(app, { email: 'sso2@example.com' });
    const status = await request(app).get('/api/v1/sso/status').set(authHeader(auth!));
    expect(status.body.data).toMatchObject({ google: false, microsoft: false, github: false });
    expect((await request(app).get('/api/v1/sso/github/url')).status).toBe(400);
    expect((await request(app).get('/api/v1/sso/myspace/url')).status).toBe(404);
  });

  it('rejects a callback with a forged state', async () => {
    const res = await request(app).get('/api/v1/sso/google/callback').query({ code: 'x', state: 'forged.state' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/sso\/complete\?error=/);
  });
});

describe('website-user email links', () => {
  it('point at the project site, or a custom URL when configured', async () => {
    const { auth } = await registerOwner(app, { email: 'links@example.com' });
    const projectId = await createProjectWithRoles(app, auth!, 'links-proj');
    await Project.updateOne({ _id: projectId }, { domain: 'shop.example.com' });
    expect(await endUserLink(projectId, 'resetPassword', 'tok 1')).toBe('https://shop.example.com/reset-password?token=tok%201');

    await Project.updateOne({ _id: projectId }, { 'settings.endUserUrls.verifyEmail': 'https://shop.example.com/account/verify/{token}' });
    expect(await endUserLink(projectId, 'verifyEmail', 'abc')).toBe('https://shop.example.com/account/verify/abc');
  });
});
