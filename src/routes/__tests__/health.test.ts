import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';

const app = createTestApp();

describe('health probes', () => {
  it('GET /live returns ok envelope (container probe)', async () => {
    const res = await request(app).get('/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.success).toBe(true);
  });

  it('GET /health and /ready return ok', async () => {
    for (const path of ['/health', '/ready']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    }
  });

  it('GET /api/v1/health returns ok', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
  });

  it('unknown route returns unified not-found envelope', async () => {
    const res = await request(app).get('/api/v1/nope-not-here');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
