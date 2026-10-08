import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import mongoose from 'mongoose';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Webhook from '../../models/Webhook.js';
import { WebhookLog } from '../../models/WebhookLog.js';
import { webhookRetryWorker } from '../webhookRetryWorker.js';

let server: Server;
let baseUrl = '';
let stubStatus = 200;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
    });
    req.on('end', () => resolve(data));
  });
}

beforeAll(async () => {
  delete process.env.WEBHOOK_RETRY_ENABLED;
  // The stub endpoint is on 127.0.0.1, which deliveries block by default (SSRF)
  process.env.ALLOW_PRIVATE_NETWORK_FETCH = 'true';
  server = createServer(async (_req: IncomingMessage, res: ServerResponse) => {
    // Drain body so fetch resolves cleanly.
    await readBody(_req);
    res.writeHead(stubStatus, { 'Content-Type': 'text/plain' });
    res.end(stubStatus === 200 ? 'ok' : 'boom');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/hook`;
});

afterEach(async () => {
  webhookRetryWorker.stop();
});

afterAll(async () => {
  delete process.env.ALLOW_PRIVATE_NETWORK_FETCH;
  webhookRetryWorker.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function createWebhook(overrides: Record<string, unknown> = {}) {
  return Webhook.create({
    tenantId: new mongoose.Types.ObjectId(),
    projectId: new mongoose.Types.ObjectId(),
    name: 'test-hook',
    url: baseUrl,
    events: ['content.published'],
    isEnabled: true,
    ...overrides,
  });
}

async function createFailedLog(webhookId: unknown, tenantId: unknown, overrides: Record<string, unknown> = {}) {
  return WebhookLog.create({
    webhookId,
    tenantId,
    event: 'content.published',
    payload: { event: 'content.published', data: { a: 1 } },
    status: 'failed',
    attempts: 1,
    error: 'HTTP 500',
    ...overrides,
  });
}

describe('webhookRetryWorker', () => {
  it('retries a due log to success via the stub endpoint', async () => {
    stubStatus = 200;
    const hook = await createWebhook();
    const log = await createFailedLog(hook._id, hook.tenantId);

    await webhookRetryWorker.processDueRetries();

    const fresh = await WebhookLog.findById(log._id).exec();
    expect(fresh).not.toBeNull();
    expect(fresh!.status).toBe('success');
    expect(fresh!.attempts).toBe(2);
    expect(fresh!.nextRetryAt).toBeUndefined();
  });

  it('schedules exponential backoff (status retrying + future nextRetryAt) on failure', async () => {
    stubStatus = 500;
    const hook = await createWebhook();
    const before = Date.now();
    const log = await createFailedLog(hook._id, hook.tenantId);

    await webhookRetryWorker.processDueRetries();

    const fresh = await WebhookLog.findById(log._id).exec();
    expect(fresh).not.toBeNull();
    expect(fresh!.status).toBe('retrying');
    expect(fresh!.attempts).toBe(2);
    expect(fresh!.nextRetryAt).toBeDefined();
    // attempts=2 -> +15m backoff (well into the future, deterministic margin)
    expect(fresh!.nextRetryAt!.getTime()).toBeGreaterThan(before + 10 * 60 * 1000);
  });

  it('dead-letters after max attempts with no further retry', async () => {
    stubStatus = 500;
    const hook = await createWebhook();
    // attempts=5 -> this retry is #6 -> dead-letter
    const log = await createFailedLog(hook._id, hook.tenantId, { attempts: 5 });

    await webhookRetryWorker.processDueRetries();

    const fresh = await WebhookLog.findById(log._id).exec();
    expect(fresh).not.toBeNull();
    expect(fresh!.status).toBe('failed');
    expect(fresh!.attempts).toBe(6);
    expect(fresh!.error).toContain('Max retry attempts exhausted');
    expect(fresh!.nextRetryAt).toBeUndefined();

    // A second sweep must not pick it up again (no double-delivery).
    await webhookRetryWorker.processDueRetries();
    const again = await WebhookLog.findById(log._id).exec();
    expect(again!.attempts).toBe(6);
  });

  it('skips logs whose webhook is inactive without retrying', async () => {
    stubStatus = 200; // even a healthy endpoint must not be hit
    const hook = await createWebhook({ isEnabled: false });
    const log = await createFailedLog(hook._id, hook.tenantId);

    await webhookRetryWorker.processDueRetries();

    const fresh = await WebhookLog.findById(log._id).exec();
    expect(fresh).not.toBeNull();
    expect(fresh!.status).toBe('failed');
    expect(fresh!.attempts).toBe(1); // untouched — no delivery attempted
    expect(fresh!.error).toContain('inactive');
    expect(fresh!.nextRetryAt).toBeUndefined();

    // A second sweep must not re-claim the terminally skipped log.
    await webhookRetryWorker.processDueRetries();
    const again = await WebhookLog.findById(log._id).exec();
    expect(again!.attempts).toBe(1);
  });

  it('respects the disabled env flag and start/stop lifecycle', () => {
    process.env.WEBHOOK_RETRY_ENABLED = 'false';
    expect(() => webhookRetryWorker.start()).not.toThrow();
    webhookRetryWorker.stop();
    delete process.env.WEBHOOK_RETRY_ENABLED;
    expect(() => webhookRetryWorker.start()).not.toThrow();
    webhookRetryWorker.stop();
  });
});
