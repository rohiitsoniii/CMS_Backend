import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { isSentryEnabled } from '../../middleware/sentry.js';

const app = createTestApp();

describe('observability', () => {
  it('GET /api/v1/metrics serves Prometheus exposition', async () => {
    const res = await request(app).get('/api/v1/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/cms_|process_/);
  });

  it('records HTTP metrics for API calls', async () => {
    await request(app).get('/api/v1/health');
    const res = await request(app).get('/api/v1/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/http_requests_total/);
  });

  it('sentry stays disabled without DSN', () => {
    expect(process.env.SENTRY_DSN).toBeFalsy();
    expect(isSentryEnabled()).toBe(false);
  });
});
