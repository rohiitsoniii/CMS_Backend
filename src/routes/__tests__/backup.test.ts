import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';

const app = createTestApp();
const backupDir = path.join(process.cwd(), 'backups');

/** Files the tests create directly — removed even if assertions fail. */
const strayFiles = new Set<string>();

const removeStray = async (name: string) => {
  strayFiles.delete(name);
  await fs.unlink(path.join(backupDir, name)).catch(() => undefined);
};

beforeAll(async () => {
  // Backup files live on disk (not the DB), so stale artifacts from prior runs
  // would leak into list/restore assertions. Wipe them in test env only.
  if (process.env.NODE_ENV !== 'test') return;
  await fs.mkdir(backupDir, { recursive: true });
  const files = await fs.readdir(backupDir).catch(() => [] as string[]);
  for (const f of files) {
    if (/^backup-.*\.json$/.test(f)) {
      await fs.unlink(path.join(backupDir, f)).catch(() => undefined);
    }
  }
});

afterAll(async () => {
  for (const f of [...strayFiles]) {
    await fs.unlink(path.join(backupDir, f)).catch(() => undefined);
  }
});

describe('backups', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/backups');
    expect(res.status).toBe(401);
  });

  it('runs the full backup lifecycle: create, list, download, traversal, restore, cleanup, delete', async () => {
    const { auth } = await registerOwner(app, { email: 'backup-owner@example.com' });
    const headers = authHeader(auth!);
    const projectId = await createProjectWithRoles(app, auth!, 'backup-proj');

    const content = await request(app)
      .post(`/api/v1/projects/${projectId}/content`)
      .set(headers)
      .send({ type: 'blog', name: 'Backup Me', data: { title: 'x' } });
    expect(content.status).toBe(201);
    const contentId: string = content.body.data._id || content.body.data.id;

    // Create full backup
    const created = await request(app).post('/api/v1/backups').set(headers).send({});
    expect(created.status).toBe(201);
    const fullFilename: string = created.body.data.backup.filename;
    expect(fullFilename).toMatch(/^backup-.*\.json$/);

    // List contains it
    const listed = await request(app).get('/api/v1/backups').set(headers);
    expect(listed.status).toBe(200);
    expect(listed.body.data.backups.map((b: any) => b.filename)).toContain(fullFilename);

    // Download returns the backup JSON, tenant-owned
    const download = await request(app)
      .get(`/api/v1/backups/${fullFilename}/download`)
      .set(headers);
    expect(download.status).toBe(200);
    const parsed = JSON.parse(download.text);
    expect(parsed.tenantId).toBe(auth!.tenantId);
    // Role / TeamMember are project-scoped — must be captured via projects.
    expect(parsed.roles.length).toBeGreaterThanOrEqual(1);

    // Path traversal is rejected on every filename-consuming endpoint
    expect(
      (await request(app).get('/api/v1/backups/..%2F..%2Fpackage.json/download').set(headers))
        .status
    ).toBe(400);
    expect(
      (await request(app).delete('/api/v1/backups/..%5C..%5Cevil.json').set(headers)).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/v1/backups/..%2F..%2Fpackage.json/restore').set(headers).send({}))
        .status
    ).toBe(400);

    // Restore reconciles without duplicate-key errors; content survives
    const restored = await request(app)
      .post(`/api/v1/backups/${fullFilename}/restore`)
      .set(headers)
      .send({});
    expect(restored.status).toBe(200);
    const contentList = await request(app)
      .get(`/api/v1/projects/${projectId}/content`)
      .set(headers);
    expect(contentList.status).toBe(200);
    expect(contentList.body.pagination.total).toBeGreaterThanOrEqual(1);
    expect(
      (await request(app).get(`/api/v1/projects/${projectId}/content/${contentId}`).set(headers))
        .status
    ).toBe(200);

    // Cleanup validates daysToKeep and never removes fresh backups
    expect(
      (await request(app).post('/api/v1/backups/cleanup').set(headers).send({ daysToKeep: 0 })).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/v1/backups/cleanup').set(headers).send({ daysToKeep: 99999 })).status
    ).toBe(400);
    const cleaned = await request(app)
      .post('/api/v1/backups/cleanup')
      .set(headers)
      .send({ daysToKeep: 3650 });
    expect(cleaned.status).toBe(200);
    expect(cleaned.body.data.deletedCount).toBe(0);

    // Missing and corrupted backups are rejected with client errors
    expect(
      (await request(app).post('/api/v1/backups/backup-missing-123.json/restore').set(headers).send({}))
        .status
    ).toBe(404);

    const corruptName = 'backup-corrupt-test.json';
    strayFiles.add(corruptName);
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(path.join(backupDir, corruptName), 'not-json{', 'utf-8');
    expect(
      (await request(app).post(`/api/v1/backups/${corruptName}/restore`).set(headers).send({}))
        .status
    ).toBe(400);
    await removeStray(corruptName);

    // Project-scoped backup: create, scoped list, restore, delete
    const projectBackup = await request(app)
      .post(`/api/v1/projects/${projectId}/backups`)
      .set(headers)
      .send({});
    expect(projectBackup.status).toBe(201);
    const projectFilename: string = projectBackup.body.data.backup.filename;
    expect(projectFilename).toMatch(/^backup-project-/);

    const projectList = await request(app)
      .get(`/api/v1/projects/${projectId}/backups`)
      .set(headers);
    expect(projectList.status).toBe(200);
    const scopedNames = projectList.body.data.backups.map((b: any) => b.filename);
    expect(scopedNames).toContain(projectFilename);
    expect(scopedNames).not.toContain(fullFilename);

    expect(
      (await request(app).post(`/api/v1/backups/${projectFilename}/restore`).set(headers).send({}))
        .status
    ).toBe(200);
    expect((await request(app).get(`/api/v1/projects/${projectId}`).set(headers)).status).toBe(200);
    expect(
      (await request(app).delete(`/api/v1/backups/${projectFilename}`).set(headers)).status
    ).toBe(200);

    // Delete full backup; subsequent delete/download are 404
    expect(
      (await request(app).delete(`/api/v1/backups/${fullFilename}`).set(headers)).status
    ).toBe(200);
    expect(
      (await request(app).delete(`/api/v1/backups/${fullFilename}`).set(headers)).status
    ).toBe(404);
    expect(
      (await request(app).get(`/api/v1/backups/${fullFilename}/download`).set(headers)).status
    ).toBe(404);

    const empty = await request(app).get('/api/v1/backups').set(headers);
    expect(empty.body.data.backups.length).toBe(0);
  });

  it('isolates backups between tenants', async () => {
    const { auth: tenantA } = await registerOwner(app, { email: 'backup-a@example.com' });
    const headersA = authHeader(tenantA!);

    const created = await request(app).post('/api/v1/backups').set(headersA).send({});
    expect(created.status).toBe(201);
    const filename: string = created.body.data.backup.filename;

    const { auth: tenantB } = await registerOwner(app, { email: 'backup-b@example.com' });
    const headersB = authHeader(tenantB!);

    // B cannot see, download, delete or restore A's backup
    const listB = await request(app).get('/api/v1/backups').set(headersB);
    expect(listB.status).toBe(200);
    expect(listB.body.data.backups.map((b: any) => b.filename)).not.toContain(filename);

    expect(
      (await request(app).get(`/api/v1/backups/${filename}/download`).set(headersB)).status
    ).toBe(403);
    expect(
      (await request(app).delete(`/api/v1/backups/${filename}`).set(headersB)).status
    ).toBe(403);
    expect(
      (await request(app).post(`/api/v1/backups/${filename}/restore`).set(headersB).send({}))
        .status
    ).toBe(403);

    // The file is still intact for its owner
    expect(
      (await request(app).delete(`/api/v1/backups/${filename}`).set(headersA)).status
    ).toBe(200);
  });
});
