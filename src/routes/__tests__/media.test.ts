import { describe, it, expect } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, ensureSubscription } from '../../test/helpers.js';
import { MediaFile } from '../../models/MediaFile.js';

const app = createTestApp();

const makePng = async (width: number, height: number): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png()
    .toBuffer();

describe('media variants + cdn urls', () => {
  it('upload stores real dimensions and api-relative url', async () => {
    const { auth } = await registerOwner(app, { email: 'media1@example.com' });
    await ensureSubscription(auth!.tenantId);
    const buf = await makePng(800, 600);

    const res = await request(app)
      .post('/api/v1/admin/media/upload')
      .set(authHeader(auth!))
      .attach('file', buf, { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.data.file.dimensions).toMatchObject({ width: 800, height: 600 });
    expect(res.body.data.file.url).toContain('/api/v1/media/');
  });

  it('serves named + custom variants as images', async () => {
    const { auth } = await registerOwner(app, { email: 'media2@example.com' });
    await ensureSubscription(auth!.tenantId);
    const buf = await makePng(800, 600);

    const upload = await request(app)
      .post('/api/v1/admin/media/upload')
      .set(authHeader(auth!))
      .attach('file', buf, { filename: 'big.png', contentType: 'image/png' });
    const id: string = upload.body.data.file._id;

    const thumb = await request(app).get(`/api/v1/media/${id}?variant=thumb`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toMatch(/image\//);

    const custom = await request(app).get(`/api/v1/media/${id}?w=200`);
    expect(custom.status).toBe(200);
    expect(custom.headers['content-type']).toMatch(/image\//);

    const original = await request(app).get(`/api/v1/media/${id}`);
    expect(original.status).toBe(200);
    expect(Number(original.headers['content-length'])).toBeGreaterThan(
      Number(thumb.headers['content-length'])
    );
  });

  it('rejects unknown variants and keeps private files gated', async () => {
    const { auth } = await registerOwner(app, { email: 'media3@example.com' });
    await ensureSubscription(auth!.tenantId);
    const buf = await makePng(100, 100);

    const upload = await request(app)
      .post('/api/v1/admin/media/upload')
      .set(authHeader(auth!))
      .attach('file', buf, { filename: 'tiny.png', contentType: 'image/png' });
    const id: string = upload.body.data.file._id;

    const bad = await request(app).get(`/api/v1/media/${id}?variant=huge`);
    expect(bad.status).toBe(400);
    expect(bad.body.success).toBe(false);

    await MediaFile.findByIdAndUpdate(id, { $set: { isPublic: false } });
    const gated = await request(app).get(`/api/v1/media/${id}`);
    expect(gated.status).toBe(403);
  });
});
