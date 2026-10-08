import dns from 'dns/promises';
import { Types } from 'mongoose';
import { EmailSubscriber } from '../models/EmailSubscriber.js';
import { EmailCampaign } from '../models/EmailCampaign.js';
import { CampaignRecipient } from '../models/CampaignRecipient.js';
import { safeGet } from '../utils/safeFetch.js';

/**
 * Deliverability: provider bounce/complaint events and sender-domain DNS checks.
 */

export type EmailEventKind = 'bounce' | 'complaint';

export interface EmailEvent {
  email: string;
  kind: EmailEventKind;
}

const lower = (e: unknown) => String(e || '').trim().toLowerCase();

/**
 * Normalise events from common providers into { email, kind }.
 * Soft bounces are ignored (the provider retries them).
 */
export async function parseProviderEvents(body: any): Promise<EmailEvent[]> {
  const out: EmailEvent[] = [];
  const push = (email: unknown, kind: EmailEventKind) => {
    const e = lower(email);
    if (/^[^\s@]+@[^\s@]+$/.test(e)) out.push({ email: e, kind });
  };

  // Amazon SES via SNS
  if (body?.Type === 'SubscriptionConfirmation' && typeof body.SubscribeURL === 'string') {
    const url = new URL(body.SubscribeURL);
    if (/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)) await safeGet(body.SubscribeURL).catch(() => undefined);
    return out;
  }
  if (body?.Type === 'Notification' && typeof body.Message === 'string') {
    try {
      body = JSON.parse(body.Message);
    } catch {
      return out;
    }
  }
  const sesType = body?.notificationType || body?.eventType;
  if (sesType === 'Bounce' && body.bounce?.bounceType === 'Permanent') {
    for (const r of body.bounce.bouncedRecipients || []) push(r.emailAddress, 'bounce');
    return out;
  }
  if (sesType === 'Complaint') {
    for (const r of body.complaint?.complainedRecipients || []) push(r.emailAddress, 'complaint');
    return out;
  }

  // Resend
  if (typeof body?.type === 'string' && body.type.startsWith('email.')) {
    const to = Array.isArray(body.data?.to) ? body.data.to : [body.data?.to];
    if (body.type === 'email.bounced') to.forEach((e: string) => push(e, 'bounce'));
    if (body.type === 'email.complained') to.forEach((e: string) => push(e, 'complaint'));
    return out;
  }

  // Mailgun
  const mg = body?.['event-data'];
  if (mg) {
    if (mg.event === 'failed' && mg.severity === 'permanent') push(mg.recipient, 'bounce');
    if (mg.event === 'complained') push(mg.recipient, 'complaint');
    return out;
  }

  // Postmark
  if (body?.RecordType) {
    if (body.RecordType === 'Bounce' && (body.Type === 'HardBounce' || body.Inactive)) push(body.Email, 'bounce');
    if (body.RecordType === 'SpamComplaint') push(body.Email, 'complaint');
    return out;
  }

  // SendGrid (array) / Brevo / generic
  const items = Array.isArray(body) ? body : [body];
  for (const ev of items) {
    const name = String(ev?.event || ev?.type || '').toLowerCase();
    if (['bounce', 'dropped', 'hard_bounce', 'hardbounce', 'blocked', 'invalid_email'].includes(name)) push(ev.email, 'bounce');
    if (['spamreport', 'spam', 'complaint', 'complained'].includes(name)) push(ev.email, 'complaint');
  }
  return out;
}

/** Suppress the contacts and attribute the event to their latest campaign. */
export async function applyEmailEvents(projectId: Types.ObjectId | string, events: EmailEvent[]): Promise<number> {
  let applied = 0;
  for (const ev of events.slice(0, 1000)) {
    const status = ev.kind === 'bounce' ? 'bounced' : 'complained';
    const sub = await EmailSubscriber.findOneAndUpdate(
      { projectId, email: ev.email },
      { $set: { status }, $inc: { bounceCount: ev.kind === 'bounce' ? 1 : 0 } },
      { new: true }
    );
    if (!sub) {
      await EmailSubscriber.create({ projectId, email: ev.email, status, source: 'suppression' }).catch(() => undefined);
    }
    const recipient = await CampaignRecipient.findOne({ projectId, email: ev.email, sentAt: { $exists: true } }).sort({ sentAt: -1 });
    if (recipient && recipient.status !== 'bounced' && ev.kind === 'bounce') {
      recipient.status = 'bounced';
      recipient.bouncedAt = new Date();
      await recipient.save();
      await EmailCampaign.updateOne({ _id: recipient.campaignId }, { $inc: { 'stats.bounced': 1, 'stats.delivered': -1 } });
    }
    if (recipient && ev.kind === 'complaint' && !recipient.unsubscribedAt) {
      recipient.unsubscribedAt = new Date();
      await recipient.save();
      await EmailCampaign.updateOne({ _id: recipient.campaignId }, { $inc: { 'stats.unsubscribed': 1 } });
    }
    applied++;
  }
  return applied;
}

// ---------------------------------------------------------------------------
// DNS checks (SPF / DKIM / DMARC / MX)
// ---------------------------------------------------------------------------

const DKIM_SELECTORS: Record<string, string[]> = {
  gmail: ['google'],
  outlook: ['selector1', 'selector2'],
  sendgrid: ['s1', 's2'],
  resend: ['resend'],
  mailgun: ['mx', 'k1', 'smtp', 'krs'],
  brevo: ['mail', 'brevo1', 'brevo2'],
  zoho: ['zmail', 'zoho'],
  ses: [],
  custom: ['default', 'selector1', 'mail', 'dkim', 'k1', 'google', 's1'],
};

const SPF_HINTS: Record<string, string> = {
  gmail: 'include:_spf.google.com',
  outlook: 'include:spf.protection.outlook.com',
  sendgrid: 'include:sendgrid.net',
  resend: 'include:amazonses.com',
  ses: 'include:amazonses.com',
  mailgun: 'include:mailgun.org',
  brevo: 'include:spf.brevo.com',
  zoho: 'include:zoho.com',
};

async function txt(name: string): Promise<string[]> {
  try {
    return (await dns.resolveTxt(name)).map((parts) => parts.join(''));
  } catch {
    return [];
  }
}

export interface DnsCheck {
  id: 'spf' | 'dkim' | 'dmarc' | 'mx';
  status: 'pass' | 'warn' | 'fail';
  record?: string;
  message: string;
  fix?: string;
}

export async function checkSenderDomain(fromEmail: string, preset = 'custom'): Promise<{ domain: string; checks: DnsCheck[] }> {
  const domain = lower(fromEmail).split('@')[1];
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error('Set a valid sender email first');

  const checks: DnsCheck[] = [];

  const spf = (await txt(domain)).find((r) => r.toLowerCase().startsWith('v=spf1'));
  const hint = SPF_HINTS[preset];
  if (!spf) {
    checks.push({ id: 'spf', status: 'fail', message: 'No SPF record found.', fix: `Add a TXT record on ${domain}: v=spf1 ${hint || 'include:<your provider>'} ~all` });
  } else if (hint && !spf.includes(hint.replace('include:', ''))) {
    checks.push({ id: 'spf', status: 'warn', record: spf, message: 'SPF exists but does not include your mail provider.', fix: `Add "${hint}" to your SPF record.` });
  } else {
    checks.push({ id: 'spf', status: 'pass', record: spf, message: 'SPF record found.' });
  }

  let dkimFound: string | undefined;
  for (const sel of DKIM_SELECTORS[preset] ?? DKIM_SELECTORS.custom) {
    const rec = (await txt(`${sel}._domainkey.${domain}`)).find((r) => /v=DKIM1|k=rsa|p=/i.test(r));
    if (rec) { dkimFound = `${sel}._domainkey`; break; }
    try {
      const cname = await dns.resolveCname(`${sel}._domainkey.${domain}`);
      if (cname.length) { dkimFound = `${sel}._domainkey → ${cname[0]}`; break; }
    } catch { /* not found */ }
  }
  checks.push(dkimFound
    ? { id: 'dkim', status: 'pass', record: dkimFound, message: 'DKIM signing key found.' }
    : { id: 'dkim', status: 'warn', message: 'No DKIM key found on common selectors.', fix: 'Enable domain authentication (DKIM) in your email provider and add the DNS records it gives you.' });

  const dmarc = (await txt(`_dmarc.${domain}`)).find((r) => r.toLowerCase().startsWith('v=dmarc1'));
  checks.push(dmarc
    ? { id: 'dmarc', status: /p=none/i.test(dmarc) ? 'warn' : 'pass', record: dmarc, message: /p=none/i.test(dmarc) ? 'DMARC is in monitoring mode (p=none).' : 'DMARC policy found.', fix: /p=none/i.test(dmarc) ? 'After checking reports, move to p=quarantine.' : undefined }
    : { id: 'dmarc', status: 'fail', message: 'No DMARC record. Gmail and Yahoo require DMARC for bulk senders.', fix: `Add a TXT record on _dmarc.${domain}: v=DMARC1; p=none; rua=mailto:dmarc@${domain}` });

  let mx: string[] = [];
  try { mx = (await dns.resolveMx(domain)).map((r) => r.exchange); } catch { /* none */ }
  checks.push(mx.length
    ? { id: 'mx', status: 'pass', record: mx.slice(0, 3).join(', '), message: 'Domain can receive replies.' }
    : { id: 'mx', status: 'warn', message: 'No MX records — replies to this address will bounce.', fix: 'Use a sender address on a domain that receives email.' });

  return { domain, checks };
}
