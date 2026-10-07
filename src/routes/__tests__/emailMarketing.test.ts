import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';
import { SMTPConfig } from '../../models/SMTPConfig.js';
import { EmailSubscriber } from '../../models/EmailSubscriber.js';
import { EmailCampaign } from '../../models/EmailCampaign.js';
import { CampaignRecipient } from '../../models/CampaignRecipient.js';
import { isEncrypted } from '../../services/cryptoService.js';
import {
  buildSegmentFilter,
  renderMergeTags,
  decorateHtml,
  prepareCampaign,
} from '../../services/emailMarketingService.js';

const app = createTestApp();

async function setup(email: string, slug: string) {
  const { auth } = await registerOwner(app, { email });
  const projectId = await createProjectWithRoles(app, auth!, slug);
  return { auth: auth!, projectId, headers: authHeader(auth!) };
}

describe('email marketing — tenant isolation', () => {
  it('does not let another tenant read or send a campaign', async () => {
    const a = await setup('em-a@example.com', 'em-a');
    const b = await setup('em-b@example.com', 'em-b');

    const created = await request(app)
      .post(`/api/v1/projects/${a.projectId}/email/campaigns`)
      .set(a.headers)
      .send({ name: 'Launch' });
    expect(created.status).toBe(201);
    const id = created.body.data._id;

    // B uses A's project id → project not found for B's tenant
    const read = await request(app).get(`/api/v1/projects/${a.projectId}/email/campaigns/${id}`).set(b.headers);
    expect(read.status).toBe(404);
    const send = await request(app).post(`/api/v1/projects/${a.projectId}/email/campaigns/${id}/send`).set(b.headers);
    expect(send.status).toBe(404);

    // B's own project cannot reach A's campaign by id
    const cross = await request(app).get(`/api/v1/projects/${b.projectId}/email/campaigns/${id}`).set(b.headers);
    expect(cross.status).toBe(404);
  });
});

describe('email settings — bring your own SMTP', () => {
  it('encrypts the SMTP password and never returns it', async () => {
    const { projectId, headers } = await setup('smtp@example.com', 'smtp-proj');
    const res = await request(app)
      .put(`/api/v1/projects/${projectId}/email/settings`)
      .set(headers)
      .send({
        provider: 'custom',
        preset: 'gmail',
        fromName: 'Acme',
        fromEmail: 'hello@acme.test',
        smtp: { host: 'smtp.gmail.com', port: 587, user: 'me@acme.test', pass: 'super-secret-app-password' },
      });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-app-password');
    expect(res.body.data.smtp.auth.hasPassword).toBe(true);

    const stored = await SMTPConfig.findOne({ projectId });
    expect(stored?.smtp?.auth.pass).not.toBe('super-secret-app-password');
    expect(isEncrypted(stored!.smtp!.auth.pass)).toBe(true);

    // Saving again without a password keeps the stored one
    const again = await request(app)
      .put(`/api/v1/projects/${projectId}/email/settings`)
      .set(headers)
      .send({ provider: 'custom', fromName: 'Acme 2', fromEmail: 'hello@acme.test', smtp: { host: 'smtp.gmail.com', port: 587, user: 'me@acme.test' } });
    expect(again.status).toBe(200);
    const after = await SMTPConfig.findOne({ projectId });
    expect(after?.smtp?.auth.pass).toBe(stored?.smtp?.auth.pass);
  });
});

describe('public signup', () => {
  it('ignores honeypot submissions and records real ones with source + tags', async () => {
    const { projectId } = await setup('pub@example.com', 'pub-proj');

    const bot = await request(app)
      .post(`/api/v1/public/email/${projectId}/subscribe`)
      .send({ email: 'bot@spam.test', website_url: 'http://spam' });
    expect(bot.status).toBe(200);
    expect(await EmailSubscriber.countDocuments({ projectId })).toBe(0);

    const real = await request(app)
      .post(`/api/v1/public/email/${projectId}/subscribe`)
      .send({ email: 'Reader@Example.com', name: 'Ada', tags: ['newsletter'], utm_source: 'twitter', form: 'Footer' });
    expect(real.status).toBe(200);
    const sub = await EmailSubscriber.findOne({ projectId, email: 'reader@example.com' });
    expect(sub?.status).toBe('subscribed');
    expect(sub?.tags).toContain('newsletter');
    expect(sub?.utm?.source).toBe('twitter');
    expect(sub?.sourceDetail).toBe('Footer');
  });

  it('uses double opt-in when enabled', async () => {
    const { projectId, headers } = await setup('doi@example.com', 'doi-proj');
    await request(app).put(`/api/v1/projects/${projectId}/email/settings`).set(headers)
      .send({ provider: 'system', fromName: 'Acme', fromEmail: 'hello@acme.test', doubleOptIn: true });

    const res = await request(app).post(`/api/v1/public/email/${projectId}/subscribe`).send({ email: 'confirm@example.com' });
    expect(res.body.needsConfirmation).toBe(true);
    const pending = await EmailSubscriber.findOne({ projectId, email: 'confirm@example.com' });
    expect(pending?.status).toBe('pending');

    const confirmed = await request(app).get(`/api/v1/public/email/confirm/${pending!.confirmToken}`);
    expect(confirmed.status).toBe(200);
    expect((await EmailSubscriber.findById(pending!._id))?.status).toBe('subscribed');
  });

  it('rejects invalid emails', async () => {
    const { projectId } = await setup('inv@example.com', 'inv-proj');
    const res = await request(app).post(`/api/v1/public/email/${projectId}/subscribe`).send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

describe('audience import & segments', () => {
  it('requires consent and never re-subscribes people who opted out', async () => {
    const { projectId, headers } = await setup('imp@example.com', 'imp-proj');
    await EmailSubscriber.create({ projectId, email: 'gone@example.com', status: 'unsubscribed' });

    const noConsent = await request(app).post(`/api/v1/projects/${projectId}/email/subscribers/import`).set(headers)
      .send({ contacts: [{ email: 'a@example.com' }] });
    expect(noConsent.status).toBe(400);

    const res = await request(app).post(`/api/v1/projects/${projectId}/email/subscribers/import`).set(headers)
      .send({ consent: true, tags: ['imported'], contacts: [{ email: 'a@example.com', name: 'A' }, { email: 'gone@example.com' }, { email: 'bad' }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ created: 1, skipped: 1, invalid: 1 });
    expect((await EmailSubscriber.findOne({ projectId, email: 'gone@example.com' }))?.status).toBe('unsubscribed');
  });

  it('previews segments and rejects unknown or injected fields', async () => {
    const { projectId, headers } = await setup('seg@example.com', 'seg-proj');
    await EmailSubscriber.create([
      { projectId, email: 'vip@example.com', tags: ['vip'] },
      { projectId, email: 'reg@example.com', tags: ['regular'] },
    ]);
    const ok = await request(app).post(`/api/v1/projects/${projectId}/email/segments/preview`).set(headers)
      .send({ match: 'all', rules: [{ field: 'tags', operator: 'equals', value: 'vip' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.count).toBe(1);

    const bad = await request(app).post(`/api/v1/projects/${projectId}/email/segments/preview`).set(headers)
      .send({ match: 'all', rules: [{ field: '$where', operator: 'equals', value: '1' }] });
    expect(bad.status).toBe(400);
  });

  it('builds filters only from whitelisted fields', () => {
    expect(() => buildSegmentFilter('507f1f77bcf86cd799439011', 'all', [{ field: 'password', operator: 'equals', value: 'x' }])).toThrow();
    const f = buildSegmentFilter('507f1f77bcf86cd799439011', 'any', [{ field: 'customFields.plan', operator: 'equals', value: 'pro' }]);
    expect(f.$or).toEqual([{ 'customFields.plan': 'pro' }]);
  });
});

describe('rendering & tracking', () => {
  it('escapes merge-tag values and supports fallbacks', () => {
    const html = renderMergeTags('<p>Hi {{first_name|there}} {{email}}</p>', { email: '<script>@x.com', name: '' });
    expect(html).toContain('Hi there');
    expect(html).toContain('&lt;script&gt;@x.com');
  });

  it('adds signed click links, an open pixel and an unsubscribe footer', () => {
    const out = decorateHtml('<p><a href="https://shop.example.com/sale">Shop</a></p>', 'tok123', { trackClicks: true, trackOpens: true });
    expect(out).toMatch(/\/c\/tok123\?u=https%3A%2F%2Fshop\.example\.com%2Fsale&s=[0-9a-f]{24}/);
    expect(out).toContain('/o/tok123.gif');
    expect(out).toContain('/u/tok123');
  });

  it('redirects valid clicks, refuses tampered links, and unsubscribes by token', async () => {
    const { auth, projectId } = await setup('trk@example.com', 'trk-proj');
    const sub = await EmailSubscriber.create({ projectId, email: 'reader@example.com' });
    const campaign = await EmailCampaign.create({
      projectId, name: 'C', subject: 'S', htmlContent: '<p>x</p>', fromName: 'A', createdBy: auth.userId, status: 'sending',
    });
    await CampaignRecipient.create({ campaignId: campaign._id, projectId, subscriberId: sub._id, email: sub.email, token: 'tok-abc', status: 'sent' });

    const html = decorateHtml('<a href="https://example.com/x">x</a>', 'tok-abc', { trackClicks: true, trackOpens: false });
    const link = html.match(/href="([^"]+)"/)![1];
    const path = link.slice(link.indexOf('/api/v1'));

    const good = await request(app).get(path);
    expect(good.status).toBe(302);
    expect(good.headers.location).toBe('https://example.com/x');

    const tampered = await request(app).get(path.replace('example.com%2Fx', 'evil.com'));
    expect(tampered.status).toBe(400);

    await request(app).get('/api/v1/public/email/o/tok-abc.gif').expect(200);
    const after = await EmailCampaign.findById(campaign._id);
    expect(after?.stats.clicked).toBe(1);
    expect(after?.stats.opened).toBe(1);

    const unsub = await request(app).post('/api/v1/public/email/u/tok-abc').type('form').send({ reason: 'too many' });
    expect(unsub.status).toBe(200);
    expect((await EmailSubscriber.findById(sub._id))?.status).toBe('unsubscribed');
  });

  it('skips suppressed contacts when preparing a campaign', async () => {
    const { auth, projectId } = await setup('prep@example.com', 'prep-proj');
    await EmailSubscriber.create([
      { projectId, email: 'yes@example.com' },
      { projectId, email: 'no@example.com', status: 'unsubscribed' },
    ]);
    const campaign = await EmailCampaign.create({
      projectId, name: 'C', subject: 'S', htmlContent: '<p>x</p>', fromName: 'A', createdBy: auth.userId,
      recipientType: 'custom', customRecipients: ['yes@example.com', 'no@example.com', 'new@example.com'],
    });
    const total = await prepareCampaign(campaign);
    expect(total).toBe(2);
    const emails = (await CampaignRecipient.find({ campaignId: campaign._id })).map((r) => r.email).sort();
    expect(emails).toEqual(['new@example.com', 'yes@example.com']);
  });
});
