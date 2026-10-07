import crypto from 'crypto';
import { Types } from 'mongoose';
import { EmailSubscriber, IEmailSubscriber } from '../models/EmailSubscriber.js';
import { EmailCampaign, IEmailCampaign } from '../models/EmailCampaign.js';
import { CampaignRecipient } from '../models/CampaignRecipient.js';
import { EmailSegment, ISegmentRule } from '../models/EmailSegment.js';
import { SMTPConfig } from '../models/SMTPConfig.js';
import { config } from '../config/index.js';
import { escapeSearchTerm } from '../utils/queryBuilder.js';
import { mailerService, QuotaExceededError } from './mailerService.js';

/**
 * Email marketing engine: audience filters, rendering, tracking, sending.
 */

const SUPPRESSED_STATUSES = ['unsubscribed', 'bounced', 'complained'];

// ---------------------------------------------------------------------------
// URLs & signing
// ---------------------------------------------------------------------------

export function publicApiBase(): string {
    const base = process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || `http://localhost:${config.port}`;
    return `${base.replace(/\/+$/, '')}/api/v1/public/email`;
}

export function sign(value: string): string {
    return crypto.createHmac('sha256', config.apiKeySecret).update(value).digest('hex').slice(0, 24);
}

export function verifySignature(value: string, sig: string | undefined): boolean {
    if (!sig) return false;
    const expected = sign(value);
    return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export const newToken = () => crypto.randomBytes(18).toString('base64url');

export const unsubscribeUrl = (token: string) => `${publicApiBase()}/u/${token}`;
const openPixelUrl = (token: string) => `${publicApiBase()}/o/${token}.gif`;
const clickUrl = (token: string, url: string) =>
    `${publicApiBase()}/c/${token}?u=${encodeURIComponent(url)}&s=${sign(`${token}|${url}`)}`;

// ---------------------------------------------------------------------------
// Segments → Mongo filter (whitelisted fields only — never raw user queries)
// ---------------------------------------------------------------------------

const FIELD_TYPES: Record<string, 'string' | 'array' | 'date' | 'number'> = {
    email: 'string',
    name: 'string',
    phone: 'string',
    status: 'string',
    source: 'string',
    sourceDetail: 'string',
    tags: 'array',
    'utm.source': 'string',
    'utm.medium': 'string',
    'utm.campaign': 'string',
    subscribedAt: 'date',
    createdAt: 'date',
    confirmedAt: 'date',
    lastEmailSentAt: 'date',
    lastEmailOpenedAt: 'date',
    lastLinkClickedAt: 'date',
    totalEmailsReceived: 'number',
    totalEmailsOpened: 'number',
    totalLinksClicked: 'number',
};

export const SEGMENT_FIELDS = Object.keys(FIELD_TYPES);

function fieldType(field: string): 'string' | 'array' | 'date' | 'number' | null {
    if (FIELD_TYPES[field]) return FIELD_TYPES[field];
    if (/^customFields\.[a-zA-Z0-9_]{1,50}$/.test(field)) return 'string';
    return null;
}

function coerce(type: string, v: any): any {
    if (type === 'number') {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error('Expected a number');
        return n;
    }
    if (type === 'date') {
        const d = new Date(v);
        if (isNaN(d.getTime())) throw new Error('Expected a date');
        return d;
    }
    if (typeof v === 'object' && v !== null) throw new Error('Invalid value');
    return String(v ?? '').trim().slice(0, 500);
}

function listValue(v: any): string[] {
    const arr = Array.isArray(v) ? v : String(v ?? '').split(',');
    return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 200);
}

export function ruleToCondition(rule: ISegmentRule): Record<string, any> {
    const type = fieldType(rule.field);
    if (!type) throw new Error(`Unknown segment field: ${rule.field}`);
    const f = rule.field;
    const days = (n: any) => new Date(Date.now() - Number(n) * 86_400_000);

    switch (rule.operator) {
        case 'equals': return { [f]: type === 'array' ? String(rule.value).toLowerCase() : coerce(type, rule.value) };
        case 'not_equals': return { [f]: { $ne: coerce(type, rule.value) } };
        case 'contains': return { [f]: { $regex: escapeSearchTerm(rule.value), $options: 'i' } };
        case 'not_contains': return { [f]: { $not: new RegExp(escapeSearchTerm(rule.value), 'i') } };
        case 'starts_with': return { [f]: { $regex: `^${escapeSearchTerm(rule.value)}`, $options: 'i' } };
        case 'in': return { [f]: { $in: listValue(rule.value).map((x) => (type === 'array' ? x.toLowerCase() : x)) } };
        case 'not_in': return { [f]: { $nin: listValue(rule.value).map((x) => (type === 'array' ? x.toLowerCase() : x)) } };
        case 'exists': return type === 'array' ? { [`${f}.0`]: { $exists: true } } : { [f]: { $exists: true, $nin: [null, ''] } };
        case 'not_exists': return type === 'array' ? { [`${f}.0`]: { $exists: false } } : { $or: [{ [f]: { $exists: false } }, { [f]: null }, { [f]: '' }] };
        case 'gt': return { [f]: { $gt: coerce(type, rule.value) } };
        case 'gte': return { [f]: { $gte: coerce(type, rule.value) } };
        case 'lt': return { [f]: { $lt: coerce(type, rule.value) } };
        case 'lte': return { [f]: { $lte: coerce(type, rule.value) } };
        case 'within_days':
            if (type !== 'date') throw new Error(`${f} is not a date field`);
            return { [f]: { $gte: days(rule.value) } };
        case 'older_than_days':
            if (type !== 'date') throw new Error(`${f} is not a date field`);
            return { $or: [{ [f]: { $lt: days(rule.value) } }, { [f]: { $exists: false } }] };
        default:
            throw new Error(`Unknown operator: ${rule.operator}`);
    }
}

export function buildSegmentFilter(projectId: string | Types.ObjectId, match: 'all' | 'any', rules: ISegmentRule[]) {
    const conditions = (rules || []).slice(0, 50).map(ruleToCondition);
    const filter: Record<string, any> = { projectId: new Types.ObjectId(String(projectId)) };
    if (conditions.length) filter[match === 'any' ? '$or' : '$and'] = conditions;
    return filter;
}

/** Subscriber filter for a campaign audience (always only active subscribers). */
export async function audienceFilter(campaign: IEmailCampaign): Promise<Record<string, any>> {
    const base: Record<string, any> = { projectId: campaign.projectId };
    let filter: Record<string, any> = base;

    if (campaign.recipientType === 'segment' && campaign.segmentId) {
        const segment = await EmailSegment.findOne({ _id: campaign.segmentId, projectId: campaign.projectId });
        if (!segment) throw new Error('Segment not found');
        filter = buildSegmentFilter(campaign.projectId, segment.match, segment.rules);
    } else if (campaign.recipientType === 'tags' && campaign.recipientSegment?.tags?.length) {
        filter = { ...base, tags: { $in: campaign.recipientSegment.tags.map((t) => t.toLowerCase()) } };
    }

    return { $and: [filter, { status: 'subscribed' }] };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const escapeHtml = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface MergeContext {
    email: string;
    name?: string;
    customFields?: Record<string, any>;
    unsubscribeUrl?: string;
}

/** Replace {{first_name}}, {{name}}, {{email}}, {{custom.key}}, {{unsubscribe_url}} (with optional |fallback). */
export function renderMergeTags(template: string, ctx: MergeContext, html = true): string {
    const firstName = (ctx.name || '').trim().split(/\s+/)[0] || '';
    const lastName = (ctx.name || '').trim().split(/\s+/).slice(1).join(' ');
    const values: Record<string, string> = {
        email: ctx.email,
        name: ctx.name || '',
        first_name: firstName,
        last_name: lastName,
        unsubscribe_url: ctx.unsubscribeUrl || '#',
    };
    return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([^}]*))?\}\}/g, (_m, key: string, fallback?: string) => {
        let v: any;
        if (key.startsWith('custom.')) v = ctx.customFields?.[key.slice(7)];
        else v = values[key];
        const out = v === undefined || v === null || v === '' ? (fallback ?? '').trim() : String(v);
        return html && key !== 'unsubscribe_url' ? escapeHtml(out) : out;
    });
}

function compliantFooter(token: string, physicalAddress?: string): string {
    return `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;font-family:Arial,sans-serif">
  ${physicalAddress ? `<p style="margin:0 0 8px">${escapeHtml(physicalAddress)}</p>` : ''}
  <p style="margin:0">Don't want these emails? <a href="${unsubscribeUrl(token)}" style="color:#6b7280">Unsubscribe</a></p>
</div>`;
}

/** Add click tracking, open pixel, preview text and the unsubscribe footer. */
export function decorateHtml(html: string, token: string, opts: {
    trackClicks: boolean;
    trackOpens: boolean;
    previewText?: string;
    physicalAddress?: string;
}): string {
    let out = html;
    const unsub = unsubscribeUrl(token);

    if (opts.trackClicks) {
        out = out.replace(/href\s*=\s*"(https?:\/\/[^"]+)"/gi, (m, url: string) => {
            if (url.startsWith(publicApiBase())) return m; // our own links (unsubscribe)
            return `href="${clickUrl(token, url.replace(/&amp;/g, '&'))}"`;
        });
    }

    const preheader = opts.previewText
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.previewText)}</div>`
        : '';
    const footer = html.includes('{{unsubscribe_url}}') || out.includes(unsub) ? '' : compliantFooter(token, opts.physicalAddress);
    const pixel = opts.trackOpens ? `<img src="${openPixelUrl(token)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />` : '';

    if (/<body[^>]*>/i.test(out)) {
        out = out.replace(/<body([^>]*)>/i, `<body$1>${preheader}`);
        out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${footer}${pixel}</body>`) : out + footer + pixel;
        return out;
    }
    return `${preheader}${out}${footer}${pixel}`;
}

const htmlToText = (html: string) =>
    html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

// ---------------------------------------------------------------------------
// Campaign lifecycle
// ---------------------------------------------------------------------------

/** Snapshot the audience into CampaignRecipient rows and start sending. */
export async function prepareCampaign(campaign: IEmailCampaign): Promise<number> {
    const suppressed = new Set(
        (await EmailSubscriber.find({ projectId: campaign.projectId, status: { $in: SUPPRESSED_STATUSES } }).select('email').lean())
            .map((s) => s.email)
    );

    type Row = { email: string; name?: string; subscriberId?: Types.ObjectId };
    let rows: Row[] = [];

    if (campaign.recipientType === 'custom') {
        const emails = [...new Set((campaign.customRecipients || []).map((e) => e.trim().toLowerCase()))]
            .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
        const known = await EmailSubscriber.find({ projectId: campaign.projectId, email: { $in: emails } }).select('email name').lean();
        const byEmail = new Map(known.map((k) => [k.email, k]));
        rows = emails.map((email) => ({ email, name: byEmail.get(email)?.name, subscriberId: byEmail.get(email)?._id as Types.ObjectId }));
    } else {
        const subs = await EmailSubscriber.find(await audienceFilter(campaign)).select('email name').lean();
        rows = subs.map((s) => ({ email: s.email, name: s.name, subscriberId: s._id as Types.ObjectId }));
    }

    rows = rows.filter((r) => !suppressed.has(r.email));

    // Idempotent: keep recipients already materialised (e.g. resumed campaign)
    const existing = new Set((await CampaignRecipient.find({ campaignId: campaign._id }).select('email').lean()).map((r) => r.email));
    const fresh = rows.filter((r) => !existing.has(r.email));

    for (let i = 0; i < fresh.length; i += 1000) {
        await CampaignRecipient.insertMany(
            fresh.slice(i, i + 1000).map((r) => ({
                campaignId: campaign._id,
                projectId: campaign.projectId,
                subscriberId: r.subscriberId,
                email: r.email,
                name: r.name,
                token: newToken(),
                status: 'pending',
            })),
            { ordered: false }
        );
    }

    const total = existing.size + fresh.length;
    campaign.stats.totalRecipients = total;
    campaign.status = 'sending';
    campaign.startedAt = campaign.startedAt || new Date();
    campaign.lastError = undefined;
    await campaign.save();
    return total;
}

const BATCH_SIZE = () => Math.max(1, parseInt(process.env.EMAIL_SEND_BATCH || '50', 10));

/** Send the next batch of one campaign. Returns number processed. */
export async function sendCampaignBatch(campaignId: Types.ObjectId | string): Promise<number> {
    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign || campaign.status !== 'sending') return 0;

    const pending = await CampaignRecipient.find({ campaignId: campaign._id, status: 'pending', attempts: { $lt: 3 } })
        .limit(BATCH_SIZE());

    if (pending.length === 0) {
        campaign.status = 'sent';
        campaign.sentAt = new Date();
        await campaign.save();
        return 0;
    }

    const settings = await SMTPConfig.findOne({ projectId: campaign.projectId }).lean();
    const subscriberIds = pending.map((p) => p.subscriberId).filter(Boolean);
    const subscribers = new Map(
        (await EmailSubscriber.find({ _id: { $in: subscriberIds } }).select('name customFields status').lean())
            .map((s) => [String(s._id), s as unknown as IEmailSubscriber])
    );

    let processed = 0;
    for (const r of pending) {
        // Re-check suppression in case they unsubscribed mid-campaign
        const sub = r.subscriberId ? subscribers.get(String(r.subscriberId)) : undefined;
        if (sub && SUPPRESSED_STATUSES.includes(sub.status)) {
            r.status = 'skipped';
            await r.save();
            processed++;
            continue;
        }

        const ctx: MergeContext = { email: r.email, name: r.name || sub?.name, customFields: sub?.customFields, unsubscribeUrl: unsubscribeUrl(r.token) };
        const body = decorateHtml(renderMergeTags(campaign.htmlContent, ctx), r.token, {
            trackClicks: campaign.trackClicks,
            trackOpens: campaign.trackOpens,
            previewText: campaign.previewText,
            physicalAddress: settings?.physicalAddress,
        });

        try {
            const result = await mailerService.send({
                projectId: campaign.projectId,
                category: 'marketing',
                throwOnError: true,
                to: r.email,
                subject: renderMergeTags(campaign.subject, ctx, false),
                html: body,
                text: campaign.textContent ? renderMergeTags(campaign.textContent, ctx, false) : htmlToText(body),
                fromName: campaign.fromName,
                fromEmail: campaign.fromEmail,
                replyTo: campaign.replyTo,
                headers: {
                    'List-Unsubscribe': `<${unsubscribeUrl(r.token)}>`,
                    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                    'X-Campaign-Id': String(campaign._id),
                },
            });
            r.status = 'sent';
            r.sentAt = new Date();
            r.attempts += 1;
            await r.save();
            await EmailCampaign.updateOne({ _id: campaign._id }, { $inc: { 'stats.sent': 1, 'stats.delivered': result.sent ? 1 : 0 } });
            if (r.subscriberId) {
                await EmailSubscriber.updateOne({ _id: r.subscriberId }, { $inc: { totalEmailsReceived: 1 }, $set: { lastEmailSentAt: new Date() } });
            }
        } catch (err: any) {
            if (err instanceof QuotaExceededError) {
                await EmailCampaign.updateOne({ _id: campaign._id }, { status: 'paused', lastError: err.message });
                return processed;
            }
            r.attempts += 1;
            r.error = String(err.message || err).slice(0, 500);
            if (r.attempts >= 3) {
                r.status = 'failed';
                await EmailCampaign.updateOne({ _id: campaign._id }, { $inc: { 'stats.failed': 1 } });
            }
            await r.save();
        }
        processed++;
    }

    // Recipients that exhausted retries without being marked (safety)
    const remaining = await CampaignRecipient.countDocuments({ campaignId: campaign._id, status: 'pending', attempts: { $lt: 3 } });
    if (remaining === 0) {
        await EmailCampaign.updateOne({ _id: campaign._id, status: 'sending' }, { status: 'sent', sentAt: new Date() });
    }
    return processed;
}

/** Send a one-off test of a campaign to the given addresses. */
export async function sendTest(campaign: IEmailCampaign, to: string[]): Promise<void> {
    const token = 'test';
    const ctx: MergeContext = { email: to[0], name: 'Test Recipient', unsubscribeUrl: '#' };
    const settings = await SMTPConfig.findOne({ projectId: campaign.projectId }).lean();
    const html = decorateHtml(renderMergeTags(campaign.htmlContent, ctx), token, {
        trackClicks: false,
        trackOpens: false,
        previewText: campaign.previewText,
        physicalAddress: settings?.physicalAddress,
    });
    await mailerService.send({
        projectId: campaign.projectId,
        category: 'transactional',
        throwOnError: true,
        to,
        subject: `[TEST] ${renderMergeTags(campaign.subject, ctx, false)}`,
        html,
        fromName: campaign.fromName,
        fromEmail: campaign.fromEmail,
        replyTo: campaign.replyTo,
    });
}

// ---------------------------------------------------------------------------
// Tracking & unsubscribe (public, token based)
// ---------------------------------------------------------------------------

export async function recordOpen(token: string): Promise<void> {
    if (!token || token === 'test') return;
    const r = await CampaignRecipient.findOne({ token });
    if (!r) return;
    const first = !r.openedAt;
    r.openCount += 1;
    if (first) {
        r.openedAt = new Date();
        if (r.status === 'sent' || r.status === 'delivered') r.status = 'opened';
    }
    await r.save();
    if (first) {
        await EmailCampaign.updateOne({ _id: r.campaignId }, { $inc: { 'stats.opened': 1 } });
        if (r.subscriberId) {
            await EmailSubscriber.updateOne({ _id: r.subscriberId }, { $inc: { totalEmailsOpened: 1 }, $set: { lastEmailOpenedAt: new Date() } });
        }
    }
}

/** Returns the destination URL when the signature is valid, else null. */
export async function recordClick(token: string, url: string, sig?: string): Promise<string | null> {
    if (!url || !/^https?:\/\//i.test(url) || !verifySignature(`${token}|${url}`, sig)) return null;
    const r = await CampaignRecipient.findOne({ token });
    if (!r) return url;
    const first = !r.clickedAt;
    r.clickCount += 1;
    if (r.clicks.length < 100) r.clicks.push({ url, clickedAt: new Date() });
    if (first) r.clickedAt = new Date();
    if (!r.openedAt) {
        // A click implies an open (image blocking)
        r.openedAt = new Date();
        await EmailCampaign.updateOne({ _id: r.campaignId }, { $inc: { 'stats.opened': 1 } });
    }
    r.status = 'clicked';
    await r.save();
    if (first) {
        await EmailCampaign.updateOne({ _id: r.campaignId }, { $inc: { 'stats.clicked': 1 } });
        if (r.subscriberId) {
            await EmailSubscriber.updateOne({ _id: r.subscriberId }, { $inc: { totalLinksClicked: 1 }, $set: { lastLinkClickedAt: new Date() } });
        }
    }
    return url;
}

export async function unsubscribeByToken(token: string, reason?: string): Promise<{ email: string } | null> {
    const r = await CampaignRecipient.findOne({ token });
    if (!r) return null;
    const res = await EmailSubscriber.updateOne(
        { projectId: r.projectId, email: r.email, status: { $ne: 'unsubscribed' } },
        { $set: { status: 'unsubscribed', unsubscribedAt: new Date(), unsubscribeReason: reason?.slice(0, 500) } }
    );
    if (!r.unsubscribedAt) {
        r.unsubscribedAt = new Date();
        await r.save();
        if (res.modifiedCount > 0) {
            await EmailCampaign.updateOne({ _id: r.campaignId }, { $inc: { 'stats.unsubscribed': 1 } });
        }
    }
    // Contacts from a pasted list may not exist yet — record them as suppressed
    if (res.matchedCount === 0) {
        await EmailSubscriber.updateOne(
            { projectId: r.projectId, email: r.email },
            { $setOnInsert: { status: 'unsubscribed', unsubscribedAt: new Date(), source: 'unsubscribe' } },
            { upsert: true }
        );
    }
    return { email: r.email };
}

// ---------------------------------------------------------------------------
// Subscribing (public forms, chatbot leads, imports)
// ---------------------------------------------------------------------------

export interface SubscribeInput {
    email: string;
    name?: string;
    phone?: string;
    tags?: string[];
    customFields?: Record<string, any>;
    source?: string;
    sourceDetail?: string;
    utm?: IEmailSubscriber['utm'];
    consentIp?: string;
    consentText?: string;
}

export async function subscribe(projectId: Types.ObjectId | string, input: SubscribeInput, opts: { doubleOptIn?: boolean } = {}) {
    const email = String(input.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
        throw new Error('A valid email address is required');
    }
    const tags = (input.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 20);
    const customFields = Object.fromEntries(
        Object.entries(input.customFields || {})
            .filter(([k]) => /^[a-zA-Z0-9_]{1,50}$/.test(k))
            .slice(0, 30)
            .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v).slice(0, 1000) : String(v).slice(0, 1000)])
    );

    let sub = await EmailSubscriber.findOne({ projectId, email });
    const isNew = !sub;

    if (!sub) {
        sub = new EmailSubscriber({
            projectId,
            email,
            source: input.source || 'form',
        });
    }

    if (input.name) sub.name = String(input.name).slice(0, 200);
    if (input.phone) sub.phone = String(input.phone).slice(0, 50);
    sub.tags = [...new Set([...(sub.tags || []), ...tags])];
    sub.customFields = { ...(sub.customFields || {}), ...customFields };
    if (isNew) {
        sub.sourceDetail = input.sourceDetail?.slice(0, 500);
        if (input.utm) sub.utm = input.utm;
    }
    sub.consentIp = input.consentIp;
    sub.consentText = input.consentText?.slice(0, 1000);
    sub.markModified('customFields');

    let needsConfirmation = false;
    // Re-subscribing an unsubscribed contact requires a fresh opt-in when double opt-in is on
    if (isNew || sub.status !== 'subscribed') {
        if (opts.doubleOptIn) {
            sub.status = 'pending';
            sub.confirmToken = newToken();
            needsConfirmation = true;
        } else {
            sub.status = 'subscribed';
            sub.subscribedAt = new Date();
            sub.unsubscribedAt = undefined;
        }
    }

    await sub.save();
    return { subscriber: sub, isNew, needsConfirmation };
}

export async function sendConfirmationEmail(projectId: Types.ObjectId | string, sub: IEmailSubscriber, projectName: string) {
    if (!sub.confirmToken) return;
    const url = `${publicApiBase()}/confirm/${sub.confirmToken}`;
    await mailerService.send({
        projectId,
        category: 'transactional',
        to: sub.email,
        subject: `Please confirm your subscription to ${projectName}`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 12px">Confirm your subscription</h2>
  <p>Hi${sub.name ? ` ${escapeHtml(sub.name.split(' ')[0])}` : ''}, thanks for signing up to ${escapeHtml(projectName)}.</p>
  <p>Please confirm your email address:</p>
  <p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:6px">Confirm subscription</a></p>
  <p style="font-size:12px;color:#6b7280">If you didn't sign up, ignore this email and you won't be subscribed.</p>
</div>`,
    });
}

export async function confirmSubscription(token: string): Promise<IEmailSubscriber | null> {
    if (!token) return null;
    const sub = await EmailSubscriber.findOne({ confirmToken: token, status: 'pending' });
    if (!sub) return null;
    sub.status = 'subscribed';
    sub.confirmedAt = new Date();
    sub.subscribedAt = new Date();
    sub.confirmToken = undefined;
    await sub.save();
    return sub;
}
