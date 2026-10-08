import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';
import { EmailSubscriber } from '../../models/EmailSubscriber.js';
import { FormSubmission } from '../../models/Form.js';
import { AutomationEnrollment, EmailAutomation } from '../../models/EmailAutomation.js';
import { EmailCampaign } from '../../models/EmailCampaign.js';
import { SMTPConfig } from '../../models/SMTPConfig.js';
import { Content, RagBot } from '../../models/index.js';
import { processDueEnrollments, onContentPublished } from '../../services/automationService.js';
import { parseProviderEvents } from '../../services/emailDeliverabilityService.js';
import { mailerService } from '../../services/mailerService.js';
import { aiGateway } from '../../services/aiGateway.js';

const app = createTestApp();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function setup(email: string, slug: string) {
  const { auth } = await registerOwner(app, { email });
  const projectId = await createProjectWithRoles(app, auth!, slug);
  return { auth: auth!, projectId, headers: authHeader(auth!) };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (k.startsWith('LIMIT_CONTACTS_')) delete process.env[k];
});

describe('website analytics', () => {
  it('records page views, ignores bots and Do-Not-Track, and reports', async () => {
    const { projectId, headers } = await setup('an@example.com', 'an-proj');
    const collect = (body: unknown, ua = UA, extra: Record<string, string> = {}) =>
      request(app).post(`/api/v1/public/analytics/${projectId}/collect`).set('User-Agent', ua).set(extra).set('Content-Type', 'text/plain').send(JSON.stringify(body));

    expect((await collect({ type: 'pageview', url: 'https://acme.test/pricing?utm_source=newsletter', referrer: 'https://google.com/search', sessionId: 's1' })).status).toBe(204);
    await collect({ type: 'pageview', url: 'https://acme.test/', sessionId: 's1' });
    await collect({ type: 'event', name: 'signup', url: 'https://acme.test/', sessionId: 's1', value: 49 });
    await collect({ type: 'pageview', url: 'https://acme.test/' }, 'Googlebot/2.1');
    await collect({ type: 'pageview', url: 'https://acme.test/' }, UA, { DNT: '1' });

    const res = await request(app).get(`/api/v1/projects/${projectId}/site-analytics`).set(headers).query({ days: 7 });
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({ pageviews: 2, visitors: 1, sessions: 1 });
    expect(res.body.data.referrers[0].key).toBe('google.com');
    expect(res.body.data.sources[0].key).toBe('newsletter');
    expect(res.body.data.events[0]).toMatchObject({ name: 'signup', count: 1, value: 49 });
  });
});

describe('forms', () => {
  it('validates, traps spam, stores submissions and adds the sender to the audience', async () => {
    const { projectId, headers } = await setup('forms@example.com', 'forms-proj');
    const created = await request(app).post(`/api/v1/projects/${projectId}/forms`).set(headers).send({
      name: 'Contact',
      settings: { addToAudience: true, audienceTags: ['lead'] },
    });
    expect(created.status).toBe(201);
    const formId = created.body.data._id;

    const def = await request(app).get(`/api/v1/public/forms/${formId}`);
    expect(def.body.data.fields.map((f: any) => f.key)).toEqual(['name', 'email', 'message']);
    expect(JSON.stringify(def.body)).not.toContain('notifyEmails');

    const invalid = await request(app).post(`/api/v1/public/forms/${formId}/submit`).send({ name: 'Ada', email: 'nope', message: 'hi' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.errors.email).toBeDefined();

    await request(app).post(`/api/v1/public/forms/${formId}/submit`).send({ name: 'Bot', email: 'bot@spam.test', message: 'x', _hp: 'filled' });
    expect(await FormSubmission.countDocuments({ formId })).toBe(0);

    const ok = await request(app).post(`/api/v1/public/forms/${formId}/submit`).send({ name: 'Ada Lovelace', email: 'ada@example.com', message: 'Hello!' });
    expect(ok.status).toBe(200);
    expect(await FormSubmission.countDocuments({ formId })).toBe(1);

    await new Promise((r) => setTimeout(r, 300)); // background audience step
    const sub = await EmailSubscriber.findOne({ projectId, email: 'ada@example.com' });
    expect(sub?.tags).toContain('lead');
    expect(sub?.source).toBe('form');

    const inbox = await request(app).get(`/api/v1/projects/${projectId}/form-submissions`).set(headers);
    expect(inbox.body.data[0].data.message).toBe('Hello!');

    const profile = await request(app).get(`/api/v1/projects/${projectId}/contacts/${sub!._id}/profile`).set(headers);
    expect(profile.status).toBe(200);
    expect(profile.body.data.timeline.some((t: any) => t.kind === 'form')).toBe(true);
  });
});

describe('email automations', () => {
  it('enrolls new subscribers and sends each step when due', async () => {
    const { projectId, headers } = await setup('auto@example.com', 'auto-proj');
    const created = await request(app).post(`/api/v1/projects/${projectId}/automations`).set(headers).send({
      name: 'Welcome',
      trigger: { type: 'subscribed' },
      steps: [
        { delayMinutes: 0, subject: 'Welcome {{first_name|friend}}', htmlContent: '<p>Hi!</p>' },
        { delayMinutes: 60 * 24, subject: 'Day 2', htmlContent: '<p>Tips</p>' },
      ],
    });
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    expect((await request(app).put(`/api/v1/projects/${projectId}/automations/${id}`).set(headers).send({ status: 'active' })).status).toBe(200);

    await request(app).post(`/api/v1/public/email/${projectId}/subscribe`).send({ email: 'new@example.com', name: 'Grace Hopper' });
    await new Promise((r) => setTimeout(r, 300));
    const enrollment = await AutomationEnrollment.findOne({ automationId: id });
    expect(enrollment?.email).toBe('new@example.com');

    const send = vi.spyOn(mailerService, 'send').mockResolvedValue({ sent: true, via: 'platform' });
    expect(await processDueEnrollments()).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][0] as any).subject).toBe('Welcome Grace');
    const after = await AutomationEnrollment.findById(enrollment!._id);
    expect(after?.stepIndex).toBe(1);
    expect(after!.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect((await EmailAutomation.findById(id))?.stats.sent).toBe(1);

    // Step campaigns are hidden from the campaigns list
    const list = await request(app).get(`/api/v1/projects/${projectId}/email/campaigns`).set(headers);
    expect(list.body.data).toHaveLength(0);
  });

  it('creates a newsletter draft when matching content is published', async () => {
    const { auth, projectId, headers } = await setup('auto2@example.com', 'auto2-proj');
    const created = await request(app).post(`/api/v1/projects/${projectId}/automations`).set(headers).send({
      name: 'New post',
      trigger: { type: 'content_published', contentTypes: ['blog'], sendMode: 'draft' },
      steps: [{ delayMinutes: 0, subject: 'New: {{post_title}}', htmlContent: '<p><a href="{{post_url}}">{{post_title}}</a></p>' }],
    });
    await request(app).put(`/api/v1/projects/${projectId}/automations/${created.body.data._id}`).set(headers).send({ status: 'active' });

    const content = await Content.create({ projectId, tenantId: auth.tenantId, type: 'blog', name: 'Launch day', slug: 'launch-day', status: 'published', data: { title: 'Launch day' }, createdBy: auth.userId });
    expect(await onContentPublished(content.toObject())).toBe(1);
    expect(await onContentPublished(content.toObject())).toBe(0); // only once per entry
    const draft = await EmailCampaign.findOne({ sourceContentId: content._id });
    expect(draft?.subject).toBe('New: Launch day');
    expect(draft?.status).toBe('draft');
  });
});

describe('deliverability', () => {
  it('normalises provider events', async () => {
    expect(await parseProviderEvents([{ event: 'bounce', email: 'A@x.com' }, { event: 'open', email: 'b@x.com' }])).toEqual([{ email: 'a@x.com', kind: 'bounce' }]);
    expect(await parseProviderEvents({ type: 'email.complained', data: { to: ['c@x.com'] } })).toEqual([{ email: 'c@x.com', kind: 'complaint' }]);
    const ses = { Type: 'Notification', Message: JSON.stringify({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'd@x.com' }] } }) };
    expect(await parseProviderEvents(ses)).toEqual([{ email: 'd@x.com', kind: 'bounce' }]);
    expect(await parseProviderEvents({ notificationType: 'Bounce', bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'e@x.com' }] } })).toEqual([]);
  });

  it('suppresses contacts via the secret webhook URL only', async () => {
    const { projectId, headers } = await setup('dlv@example.com', 'dlv-proj');
    await request(app).put(`/api/v1/projects/${projectId}/email/settings`).set(headers).send({ provider: 'system', fromName: 'A', fromEmail: 'a@acme.test' });
    await EmailSubscriber.create({ projectId, email: 'gone@example.com' });
    const hook = await request(app).get(`/api/v1/projects/${projectId}/email/settings/events-webhook`).set(headers);
    const url: string = hook.body.data.url;
    const path = url.slice(url.indexOf('/api/v1'));

    expect((await request(app).post(path.replace(/[^/]+$/, 'wrong-token')).send([{ event: 'bounce', email: 'gone@example.com' }])).status).toBe(404);
    const ok = await request(app).post(path).send([{ event: 'bounce', email: 'gone@example.com' }]);
    expect(ok.body.data.applied).toBe(1);
    expect((await EmailSubscriber.findOne({ projectId, email: 'gone@example.com' }))?.status).toBe('bounced');
    expect((await SMTPConfig.findOne({ projectId }).select('+eventsToken'))?.eventsToken).toBeTruthy();
  });
});

describe('chatbot human takeover', () => {
  it('routes visitor messages to the inbox while a human handles the chat', async () => {
    const { auth, projectId, headers } = await setup('inbox@example.com', 'inbox-proj');
    const bot = await RagBot.create({
      projectId, tenantId: auth.tenantId, name: 'Helper', slug: 'helper', apiKey: 'bot_key_123', status: 'active',
      persona: { systemPrompt: 'Help', temperature: 0.5, model: 'x', maxResponseTokens: 200, language: 'en' },
      widget: { name: 'Helper', primaryColor: '#000', secondaryColor: '#000', position: 'bottom-right', greeting: 'Hi', placeholder: '...', suggestedQuestions: [], showSources: false, collectEmail: false },
      createdBy: auth.userId,
    });
    const key = { 'x-bot-key': 'bot_key_123' };
    const handoff = await request(app).post('/api/v1/bots/helper/handoff').set(key).send({ sessionId: 'sess-1', email: 'visitor@example.com' });
    expect(handoff.status).toBe(200);

    const ai = vi.spyOn(aiGateway, 'chat');
    const chat = await request(app).post('/api/v1/bots/helper/chat').set(key).send({ sessionId: 'sess-1', message: 'Is anyone there?' });
    expect(chat.status).toBe(200);
    expect(chat.body.data.handoff).toBe('requested');
    expect(ai).not.toHaveBeenCalled();

    const list = await request(app).get(`/api/v1/projects/${projectId}/inbox`).set(headers);
    expect(list.body.data.conversations).toHaveLength(1);
    const convId = list.body.data.conversations[0]._id;
    expect(list.body.data.conversations[0].unread).toBeGreaterThan(0);

    const since = new Date().toISOString();
    await request(app).post(`/api/v1/projects/${projectId}/inbox/${convId}/reply`).set(headers).send({ message: 'Yes, how can I help?' });
    const poll = await request(app).get('/api/v1/bots/helper/messages').set(key).query({ sessionId: 'sess-1', after: since });
    expect(poll.body.data.status).toBe('human');
    expect(poll.body.data.messages.map((m: any) => m.content)).toContain('Yes, how can I help?');

    // Another tenant can't read it
    const other = await setup('inbox-b@example.com', 'inbox-b');
    expect((await request(app).get(`/api/v1/projects/${projectId}/inbox/${convId}`).set(other.headers)).status).toBe(404);
    expect(bot._id).toBeDefined();
  });
});

describe('plan limits & usage', () => {
  it('blocks new contacts beyond the plan and reports usage', async () => {
    const { projectId, headers } = await setup('lim@example.com', 'lim-proj');
    const usage = await request(app).get('/api/v1/usage').set(headers);
    expect(usage.status).toBe(200);
    const plan = usage.body.data.plan as string;
    expect(usage.body.data.items.find((i: any) => i.label === 'Contacts')).toBeDefined();

    process.env[`LIMIT_CONTACTS_${plan.toUpperCase()}`] = '1';
    expect((await request(app).post(`/api/v1/public/email/${projectId}/subscribe`).send({ email: 'one@example.com' })).status).toBe(200);
    const second = await request(app).post(`/api/v1/public/email/${projectId}/subscribe`).send({ email: 'two@example.com' });
    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/plan includes 1 contacts/);
  });
});

describe('popups', () => {
  it('serves published popups with their display rules', async () => {
    const { auth, projectId } = await setup('pop@example.com', 'pop-proj');
    await Content.create({
      projectId, tenantId: auth.tenantId, type: 'popup', name: 'Welcome offer', slug: 'welcome-offer', status: 'published', createdBy: auth.userId,
      data: { title: '10% off', body: 'Join our list', collectEmail: true, trigger: { type: 'exit_intent' }, pages: ['/pricing'], frequency: 'once' },
    });
    await Content.create({ projectId, tenantId: auth.tenantId, type: 'popup', name: 'Draft', slug: 'draft-popup', status: 'draft', createdBy: auth.userId, data: { title: 'x' } });
    const res = await request(app).get(`/api/v1/public/popups/${projectId}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ title: '10% off', collectEmail: true, trigger: { type: 'exit_intent' }, pages: ['/pricing'], frequency: 'once' });
  });
});
