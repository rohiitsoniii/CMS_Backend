import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader } from '../../test/helpers.js';
import { AIProviderConfig } from '../../models/AIProviderConfig.js';
import { AIUsageMonthly } from '../../models/AIUsage.js';
import { isEncrypted } from '../../services/cryptoService.js';

const app = createTestApp();
const month = () => new Date().toISOString().slice(0, 7);

function mockCompletion(text = 'Great title') {
  return vi.spyOn(axios, 'post').mockResolvedValue({
    data: { model: 'test-model', choices: [{ message: { content: text } }], usage: { prompt_tokens: 40, completion_tokens: 10 } },
  } as any);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENROUTER_API_KEY;
});

describe('AI — bring your own key', () => {
  it('stores the key encrypted and never returns it', async () => {
    const { auth } = await registerOwner(app, { email: 'byok1@example.com' });
    const res = await request(app).put('/api/v1/ai/settings').set(authHeader(auth!))
      .send({ provider: 'openai', apiKey: 'sk-test-1234567890abcd', skipTest: true });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('sk-test-1234567890abcd');
    expect(res.body.data.keyLast4).toBe('abcd');

    const stored = await AIProviderConfig.findOne({ tenantId: auth!.tenantId });
    expect(isEncrypted(stored!.apiKey)).toBe(true);
  });

  it('routes AI calls through the tenant key and meters them as BYOK', async () => {
    const { auth } = await registerOwner(app, { email: 'byok2@example.com' });
    await request(app).put('/api/v1/ai/settings').set(authHeader(auth!))
      .send({ provider: 'openai', apiKey: 'sk-tenant-key-0001', skipTest: true });
    const spy = mockCompletion();

    const res = await request(app).post('/api/v1/ai/seo/title').set(authHeader(auth!)).send({ content: 'An article about headless CMS' });
    expect(res.status).toBe(200);

    const [url, , config] = spy.mock.calls[0] as any[];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(config.headers.Authorization).toBe('Bearer sk-tenant-key-0001');

    const usage = await AIUsageMonthly.findOne({ tenantId: auth!.tenantId, month: month() });
    expect(usage?.byokTokens).toBe(50);
    expect(usage?.platformTokens || 0).toBe(0);
  });

  it('blocks platform AI when the plan allowance is used up', async () => {
    process.env.OPENROUTER_API_KEY = 'platform-key';
    const { auth } = await registerOwner(app, { email: 'byok3@example.com' });
    await AIUsageMonthly.create({ tenantId: auth!.tenantId, month: month(), platformTokens: 10_000_000 });
    const spy = mockCompletion();

    const res = await request(app).post('/api/v1/ai/seo/title').set(authHeader(auth!)).send({ content: 'x' });
    expect(res.status).toBe(402);
    expect(spy).not.toHaveBeenCalled();
  });

  it('meters platform usage against credits', async () => {
    process.env.OPENROUTER_API_KEY = 'platform-key';
    const { auth } = await registerOwner(app, { email: 'byok4@example.com' });
    mockCompletion();
    const res = await request(app).post('/api/v1/ai/seo/title').set(authHeader(auth!)).send({ content: 'x' });
    expect(res.status).toBe(200);
    const usage = await AIUsageMonthly.findOne({ tenantId: auth!.tenantId, month: month() });
    expect(usage?.platformTokens).toBe(50);

    const summary = await request(app).get('/api/v1/ai/usage').set(authHeader(auth!));
    expect(summary.status).toBe(200);
    expect(summary.body.data.platformTokens).toBe(50);
    expect(summary.body.data.byok.active).toBe(false);
  });
});
