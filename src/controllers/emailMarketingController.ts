import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Project } from '../models/index.js';
import { EmailSubscriber } from '../models/EmailSubscriber.js';
import { EmailCampaign } from '../models/EmailCampaign.js';
import { CampaignRecipient } from '../models/CampaignRecipient.js';
import { EmailSegment } from '../models/EmailSegment.js';
import { EmailTemplate } from '../models/EmailTemplate.js';
import { SMTPConfig, SMTP_PRESETS } from '../models/SMTPConfig.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { escapeSearchTerm } from '../utils/queryBuilder.js';
import { mailerService } from '../services/mailerService.js';
import {
    buildSegmentFilter,
    audienceFilter,
    prepareCampaign,
    sendCampaignBatch,
    sendTest,
    subscribe,
    SEGMENT_FIELDS,
} from '../services/emailMarketingService.js';

/**
 * Email marketing: settings (BYO SMTP), audience, segments, campaigns, templates.
 * Mounted at /api/v1/projects/:projectId/email — every query is scoped to a
 * project that belongs to the caller's tenant.
 */

const isId = (v: unknown) => typeof v === 'string' && Types.ObjectId.isValid(v);

async function loadProject(req: Request) {
    const { projectId } = req.params;
    if (!isId(projectId)) throw new AppError('Invalid project id', 400);
    const project = await Project.findOne({ _id: projectId, tenantId: req.tenantId });
    if (!project) throw new AppError('Project not found', 404);
    return project;
}

const pageParams = (req: Request) => {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    return { page, limit, skip: (page - 1) * limit };
};

const cleanTags = (tags: unknown): string[] =>
    (Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : [])
        .map((t) => String(t).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 50);

const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// ============================================================================
// Settings (BYO SMTP)
// ============================================================================

export const getSettings = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const settings = await SMTPConfig.findOne({ projectId: project._id });
    res.json({
        success: true,
        data: {
            settings,
            presets: SMTP_PRESETS,
            platformConfigured: mailerService.isPlatformConfigured(),
            usingOwnSmtp: Boolean(settings && settings.isActive && settings.provider === 'custom' && settings.smtp),
        },
    });
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const body = req.body || {};
    let settings = await SMTPConfig.findOne({ projectId: project._id });

    const fromName = String(body.fromName ?? settings?.fromName ?? project.name).trim();
    const fromEmail = String(body.fromEmail ?? settings?.fromEmail ?? '').trim().toLowerCase();
    if (!fromName) throw new AppError('Sender name is required', 400);
    if (!isEmail(fromEmail)) throw new AppError('A valid sender email is required', 400);

    if (!settings) {
        settings = new SMTPConfig({ projectId: project._id, tenantId: project.tenantId, fromName, fromEmail });
    }
    settings.tenantId = project.tenantId as any;
    settings.fromName = fromName;
    settings.fromEmail = fromEmail;
    if (body.replyTo !== undefined) settings.replyTo = body.replyTo ? String(body.replyTo).trim().toLowerCase() : undefined;
    if (body.physicalAddress !== undefined) settings.physicalAddress = String(body.physicalAddress || '').slice(0, 500);
    if (body.doubleOptIn !== undefined) settings.doubleOptIn = Boolean(body.doubleOptIn);
    if (body.isActive !== undefined) settings.isActive = Boolean(body.isActive);

    const provider = body.provider === 'custom' ? 'custom' : body.provider === 'system' ? 'system' : settings.provider;
    settings.provider = provider;

    if (provider === 'custom' && body.smtp) {
        const s = body.smtp;
        const host = String(s.host || settings.smtp?.host || '').trim();
        const port = parseInt(String(s.port ?? settings.smtp?.port ?? 587), 10);
        const user = String(s.user ?? settings.smtp?.auth?.user ?? '').trim();
        // Keep the stored password when the client leaves it blank
        const pass = s.pass ? String(s.pass) : settings.smtp?.auth?.pass;
        if (!host || !user || !pass) throw new AppError('SMTP host, username and password are required', 400);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError('Invalid SMTP port', 400);

        const changed = host !== settings.smtp?.host || user !== settings.smtp?.auth?.user || Boolean(s.pass) || port !== settings.smtp?.port;
        settings.smtp = {
            host,
            port,
            secure: s.secure !== undefined ? Boolean(s.secure) : port === 465,
            auth: { user, pass: pass! },
        };
        if (body.preset && body.preset in SMTP_PRESETS) settings.preset = body.preset;
        if (changed) {
            settings.isVerified = false;
            settings.lastError = undefined;
        }
    }
    if (provider === 'custom' && !settings.smtp) {
        throw new AppError('SMTP settings are required to use your own mail server', 400);
    }

    await settings.save();
    res.json({ success: true, data: settings, message: 'Email settings saved' });
});

export const testSettings = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const to = String(req.body?.to || '').trim().toLowerCase();
    if (!isEmail(to)) throw new AppError('A valid test recipient is required', 400);

    const settings = await SMTPConfig.findOne({ projectId: project._id });
    try {
        if (settings?.provider === 'custom' && settings.smtp) {
            await mailerService.verifySettings(mailerService.plainSettings(settings)!);
        }
        const result = await mailerService.send({
            projectId: project._id,
            category: 'transactional',
            throwOnError: true,
            to,
            subject: `Test email from ${project.name}`,
            html: `<div style="font-family:Arial,sans-serif;padding:24px"><h2>It works! ✅</h2><p>Your email settings for <strong>${project.name.replace(/</g, '&lt;')}</strong> are working.</p></div>`,
        });
        if (settings) {
            settings.isVerified = result.via === 'custom' ? true : settings.isVerified;
            settings.lastTestedAt = new Date();
            settings.lastError = undefined;
            await settings.save();
        }
        res.json({ success: true, data: { via: result.via }, message: result.via === 'mock' ? 'No mail server configured — email was logged, not sent' : 'Test email sent' });
    } catch (err: any) {
        if (settings) {
            settings.isVerified = false;
            settings.lastTestedAt = new Date();
            settings.lastError = String(err.message || err).slice(0, 500);
            await settings.save();
        }
        throw new AppError(`Could not send test email: ${err.message}`, 400);
    }
});

export const removeOwnSmtp = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const settings = await SMTPConfig.findOne({ projectId: project._id });
    if (settings) {
        settings.provider = 'system';
        settings.smtp = undefined;
        settings.isVerified = false;
        await settings.save();
    }
    res.json({ success: true, message: 'Switched back to the platform mail server' });
});

// ============================================================================
// Subscribers (audience)
// ============================================================================

export const listSubscribers = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const { page, limit, skip } = pageParams(req);
    const filter: Record<string, any> = { projectId: project._id };
    if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status;
    if (typeof req.query.tag === 'string' && req.query.tag) filter.tags = req.query.tag.toLowerCase();
    if (typeof req.query.source === 'string' && req.query.source) filter.source = req.query.source;
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
        const term = escapeSearchTerm(req.query.search.trim());
        filter.$or = [{ email: { $regex: term, $options: 'i' } }, { name: { $regex: term, $options: 'i' } }];
    }
    if (isId(req.query.segmentId)) {
        const segment = await EmailSegment.findOne({ _id: req.query.segmentId, projectId: project._id });
        if (segment) Object.assign(filter, { $and: [buildSegmentFilter(project._id, segment.match, segment.rules)] });
    }

    const [items, total] = await Promise.all([
        EmailSubscriber.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        EmailSubscriber.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const subscriberStats = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [byStatus, bySource, growth, tags] = await Promise.all([
        EmailSubscriber.aggregate([{ $match: { projectId: project._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
        EmailSubscriber.aggregate([{ $match: { projectId: project._id } }, { $group: { _id: '$source', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
        EmailSubscriber.aggregate([
            { $match: { projectId: project._id, createdAt: { $gte: since } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]),
        EmailSubscriber.distinct('tags', { projectId: project._id }),
    ]);
    const statusCounts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
    res.json({
        success: true,
        data: {
            total: byStatus.reduce((n, s) => n + s.count, 0),
            subscribed: statusCounts.subscribed || 0,
            pending: statusCounts.pending || 0,
            unsubscribed: statusCounts.unsubscribed || 0,
            bounced: (statusCounts.bounced || 0) + (statusCounts.complained || 0),
            bySource: bySource.map((s) => ({ source: s._id || 'unknown', count: s.count })),
            growth: growth.map((g) => ({ date: g._id, count: g.count })),
            tags: tags.sort(),
        },
    });
});

export const createSubscriber = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const { email, name, phone, tags, customFields } = req.body || {};
    try {
        const { subscriber, isNew } = await subscribe(project._id, {
            email, name, phone, tags: cleanTags(tags), customFields, source: 'manual',
        });
        res.status(isNew ? 201 : 200).json({ success: true, data: subscriber, message: isNew ? 'Contact added' : 'Contact updated' });
    } catch (err: any) {
        throw new AppError(err.message, 400);
    }
});

export const updateSubscriber = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
    const sub = await EmailSubscriber.findOne({ _id: req.params.id, projectId: project._id });
    if (!sub) throw new AppError('Contact not found', 404);
    const { name, phone, tags, customFields, status } = req.body || {};
    if (name !== undefined) sub.name = String(name).slice(0, 200);
    if (phone !== undefined) sub.phone = String(phone).slice(0, 50);
    if (tags !== undefined) sub.tags = cleanTags(tags);
    if (customFields && typeof customFields === 'object') {
        sub.customFields = Object.fromEntries(
            Object.entries(customFields).filter(([k]) => /^[a-zA-Z0-9_]{1,50}$/.test(k)).slice(0, 30)
        );
        sub.markModified('customFields');
    }
    // Admins may unsubscribe someone, but never silently re-subscribe them
    if (status === 'unsubscribed' && sub.status !== 'unsubscribed') {
        sub.status = 'unsubscribed';
        sub.unsubscribedAt = new Date();
        sub.unsubscribeReason = 'Removed by admin';
    }
    await sub.save();
    res.json({ success: true, data: sub });
});

export const deleteSubscriber = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
    const result = await EmailSubscriber.deleteOne({ _id: req.params.id, projectId: project._id });
    if (!result.deletedCount) throw new AppError('Contact not found', 404);
    res.json({ success: true, message: 'Contact deleted' });
});

export const bulkSubscribers = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const { action, ids, tags } = req.body || {};
    const validIds = (Array.isArray(ids) ? ids : []).filter(isId).slice(0, 5000);
    if (!validIds.length) throw new AppError('No contacts selected', 400);
    const filter = { projectId: project._id, _id: { $in: validIds } };
    const t = cleanTags(tags);
    let result;
    switch (action) {
        case 'delete': result = await EmailSubscriber.deleteMany(filter); break;
        case 'tag': result = await EmailSubscriber.updateMany(filter, { $addToSet: { tags: { $each: t } } }); break;
        case 'untag': result = await EmailSubscriber.updateMany(filter, { $pull: { tags: { $in: t } } }); break;
        case 'unsubscribe':
            result = await EmailSubscriber.updateMany(
                { ...filter, status: { $ne: 'unsubscribed' } },
                { $set: { status: 'unsubscribed', unsubscribedAt: new Date(), unsubscribeReason: 'Removed by admin' } }
            );
            break;
        default: throw new AppError('Unknown action', 400);
    }
    res.json({ success: true, data: result });
});

export const importSubscribers = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const { contacts, tags, consent } = req.body || {};
    if (!consent) throw new AppError('Please confirm these contacts agreed to receive your emails', 400);
    if (!Array.isArray(contacts) || contacts.length === 0) throw new AppError('No contacts to import', 400);
    if (contacts.length > 10_000) throw new AppError('Import at most 10,000 contacts per upload', 400);

    const extraTags = cleanTags(tags);
    const summary = { created: 0, updated: 0, skipped: 0, invalid: 0 };
    const seen = new Set<string>();
    const ops: any[] = [];

    const existing = new Map(
        (await EmailSubscriber.find({
            projectId: project._id,
            email: { $in: contacts.map((c: any) => String(c?.email || '').trim().toLowerCase()) },
        }).select('email status').lean()).map((s) => [s.email, s.status])
    );

    for (const c of contacts) {
        const email = String(c?.email || '').trim().toLowerCase();
        if (!isEmail(email) || email.length > 254) { summary.invalid++; continue; }
        if (seen.has(email)) { summary.skipped++; continue; }
        seen.add(email);

        const status = existing.get(email);
        // Never re-subscribe people who opted out or bounced
        if (status && status !== 'subscribed' && status !== 'pending') { summary.skipped++; continue; }

        const customFields = Object.fromEntries(
            Object.entries(c.customFields || {}).filter(([k]) => /^[a-zA-Z0-9_]{1,50}$/.test(k)).slice(0, 30)
                .map(([k, v]) => [`customFields.${k}`, String(v).slice(0, 1000)])
        );
        const rowTags = [...new Set([...cleanTags(c.tags), ...extraTags])];
        ops.push({
            updateOne: {
                filter: { projectId: project._id, email },
                update: {
                    $set: { ...(c.name ? { name: String(c.name).slice(0, 200) } : {}), ...(c.phone ? { phone: String(c.phone).slice(0, 50) } : {}), ...customFields },
                    $addToSet: { tags: { $each: rowTags } },
                    $setOnInsert: { status: 'subscribed', subscribedAt: new Date(), source: 'import', consentText: 'Imported by admin with consent confirmation' },
                },
                upsert: true,
            },
        });
        if (status) summary.updated++; else summary.created++;
    }

    for (let i = 0; i < ops.length; i += 1000) {
        await EmailSubscriber.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    }
    res.json({ success: true, data: summary, message: `Imported ${summary.created} new, updated ${summary.updated}` });
});

const csvCell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    // Neutralise spreadsheet formula injection
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const exportSubscribers = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const filter: Record<string, any> = { projectId: project._id };
    if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status;
    const subs = await EmailSubscriber.find(filter).sort({ createdAt: -1 }).limit(100_000).lean();
    const header = ['email', 'name', 'phone', 'status', 'tags', 'source', 'subscribed_at', 'emails_received', 'emails_opened', 'links_clicked'];
    const lines = [header.join(',')].concat(
        subs.map((s) => [s.email, s.name, s.phone, s.status, (s.tags || []).join(';'), s.source, s.subscribedAt?.toISOString(),
            s.totalEmailsReceived, s.totalEmailsOpened, s.totalLinksClicked].map(csvCell).join(','))
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contacts-${project.slug || project._id}.csv"`);
    res.send(lines.join('\n'));
});

// ============================================================================
// Segments
// ============================================================================

export const segmentFields = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const sample = await EmailSubscriber.find({ projectId: project._id, customFields: { $exists: true } }).select('customFields').limit(200).lean();
    const custom = new Set<string>();
    sample.forEach((s) => Object.keys(s.customFields || {}).forEach((k) => custom.add(`customFields.${k}`)));
    res.json({ success: true, data: [...SEGMENT_FIELDS, ...custom] });
});

export const listSegments = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const segments = await EmailSegment.find({ projectId: project._id }).sort({ createdAt: -1 });
    res.json({ success: true, data: segments });
});

async function countSegment(projectId: Types.ObjectId, match: 'all' | 'any', rules: any[]) {
    let filter;
    try {
        filter = buildSegmentFilter(projectId, match, rules);
    } catch (err: any) {
        throw new AppError(err.message, 400);
    }
    const subscribed = { $and: [filter, { status: 'subscribed' }] };
    const [count, sample] = await Promise.all([
        EmailSubscriber.countDocuments(subscribed),
        EmailSubscriber.find(subscribed).select('email name tags').limit(10).lean(),
    ]);
    return { count, sample };
}

export const previewSegment = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const { match = 'all', rules = [] } = req.body || {};
    res.json({ success: true, data: await countSegment(project._id, match === 'any' ? 'any' : 'all', rules) });
});

export const createSegment = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const { name, description, match = 'all', rules = [] } = req.body || {};
    if (!name) throw new AppError('Segment name is required', 400);
    const { count } = await countSegment(project._id, match, rules); // validates rules
    const segment = await EmailSegment.create({
        projectId: project._id, tenantId: project.tenantId, name, description, match, rules,
        lastCount: count, lastCountedAt: new Date(), createdBy: req.user?._id,
    });
    res.status(201).json({ success: true, data: segment });
});

export const updateSegment = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
    const segment = await EmailSegment.findOne({ _id: req.params.id, projectId: project._id });
    if (!segment) throw new AppError('Segment not found', 404);
    const { name, description, match, rules } = req.body || {};
    if (name !== undefined) segment.name = name;
    if (description !== undefined) segment.description = description;
    if (match !== undefined) segment.match = match === 'any' ? 'any' : 'all';
    if (rules !== undefined) segment.rules = rules;
    const { count } = await countSegment(project._id, segment.match, segment.rules);
    segment.lastCount = count;
    segment.lastCountedAt = new Date();
    await segment.save();
    res.json({ success: true, data: segment });
});

export const deleteSegment = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
    const inUse = await EmailCampaign.exists({ projectId: project._id, segmentId: req.params.id, status: { $in: ['scheduled', 'sending', 'paused'] } });
    if (inUse) throw new AppError('Segment is used by an active campaign', 409);
    await EmailSegment.deleteOne({ _id: req.params.id, projectId: project._id });
    res.json({ success: true, message: 'Segment deleted' });
});

// ============================================================================
// Campaigns
// ============================================================================

const EDITABLE = ['draft', 'scheduled', 'paused'];

async function loadCampaign(req: Request) {
    const project = await loadProject(req);
    if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
    const campaign = await EmailCampaign.findOne({ _id: req.params.id, projectId: project._id });
    if (!campaign) throw new AppError('Campaign not found', 404);
    return { project, campaign };
}

function campaignFields(body: any) {
    const out: Record<string, any> = {};
    for (const k of ['name', 'subject', 'previewText', 'htmlContent', 'textContent', 'fromName', 'fromEmail', 'replyTo', 'trackOpens', 'trackClicks']) {
        if (body[k] !== undefined) out[k] = body[k];
    }
    if (body.recipientType !== undefined) {
        if (!['all', 'segment', 'tags', 'custom'].includes(body.recipientType)) throw new AppError('Invalid audience type', 400);
        out.recipientType = body.recipientType;
    }
    if (body.segmentId !== undefined) out.segmentId = isId(body.segmentId) ? body.segmentId : undefined;
    if (body.tags !== undefined) out.recipientSegment = { tags: cleanTags(body.tags) };
    if (body.customRecipients !== undefined) {
        const list = (Array.isArray(body.customRecipients) ? body.customRecipients : String(body.customRecipients).split(/[\s,;]+/))
            .map((e: string) => e.trim().toLowerCase()).filter(isEmail);
        out.customRecipients = [...new Set(list)].slice(0, 10_000);
    }
    if (body.templateId !== undefined) out.templateId = isId(body.templateId) ? body.templateId : undefined;
    return out;
}

export const listCampaigns = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const filter: Record<string, any> = { projectId: project._id };
    if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status;
    const campaigns = await EmailCampaign.find(filter).select('-htmlContent -textContent -customRecipients').sort({ createdAt: -1 }).limit(500);
    res.json({ success: true, data: campaigns });
});

export const getCampaign = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    res.json({ success: true, data: campaign });
});

export const createCampaign = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const fields = campaignFields(req.body || {});
    const settings = await SMTPConfig.findOne({ projectId: project._id });
    if (!fields.name) throw new AppError('Campaign name is required', 400);
    const campaign = await EmailCampaign.create({
        subject: fields.name,
        htmlContent: '<p>Hi {{first_name|there}},</p><p>Write your message here.</p>',
        fromName: settings?.fromName || project.name,
        fromEmail: settings?.fromEmail,
        replyTo: settings?.replyTo,
        ...fields,
        projectId: project._id,
        tenantId: project.tenantId,
        status: 'draft',
        createdBy: req.user?._id,
    });
    res.status(201).json({ success: true, data: campaign });
});

export const updateCampaign = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    if (!EDITABLE.includes(campaign.status)) throw new AppError(`A ${campaign.status} campaign can't be edited`, 400);
    campaign.set(campaignFields(req.body || {}));
    await campaign.save();
    res.json({ success: true, data: campaign });
});

export const deleteCampaign = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    if (campaign.status === 'sending') throw new AppError('Pause the campaign before deleting it', 400);
    await CampaignRecipient.deleteMany({ campaignId: campaign._id });
    await campaign.deleteOne();
    res.json({ success: true, message: 'Campaign deleted' });
});

export const duplicateCampaign = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    const src = campaign.toObject();
    const copy = await EmailCampaign.create({
        ...campaignFields(src),
        segmentId: src.segmentId,
        recipientSegment: src.recipientSegment,
        customRecipients: src.customRecipients,
        name: `${src.name} (copy)`,
        projectId: src.projectId,
        tenantId: src.tenantId,
        status: 'draft',
        createdBy: req.user?._id,
    });
    res.status(201).json({ success: true, data: copy });
});

async function audienceCount(campaign: any): Promise<number> {
    if (campaign.recipientType === 'custom') return (campaign.customRecipients || []).length;
    try {
        return await EmailSubscriber.countDocuments(await audienceFilter(campaign));
    } catch (err: any) {
        throw new AppError(err.message, 400);
    }
}

export const estimateAudience = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const draft: any = { projectId: project._id, recipientType: 'all', ...campaignFields(req.body || {}) };
    res.json({ success: true, data: { count: await audienceCount(draft) } });
});

export const testCampaign = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    const to = (Array.isArray(req.body?.to) ? req.body.to : String(req.body?.to || '').split(/[\s,;]+/))
        .map((e: string) => e.trim().toLowerCase()).filter(isEmail).slice(0, 5);
    if (!to.length) throw new AppError('Enter at least one valid test address', 400);
    try {
        await sendTest(campaign, to);
    } catch (err: any) {
        throw new AppError(`Test send failed: ${err.message}`, 400);
    }
    res.json({ success: true, message: `Test sent to ${to.join(', ')}` });
});

function assertSendable(campaign: any) {
    if (!campaign.subject?.trim()) throw new AppError('Add a subject line first', 400);
    if (!campaign.htmlContent?.trim()) throw new AppError('Add email content first', 400);
    if (campaign.recipientType === 'segment' && !campaign.segmentId) throw new AppError('Choose a segment', 400);
    if (campaign.recipientType === 'tags' && !campaign.recipientSegment?.tags?.length) throw new AppError('Choose at least one tag', 400);
}

export const sendCampaign = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    if (!['draft', 'scheduled'].includes(campaign.status)) throw new AppError(`A ${campaign.status} campaign can't be sent`, 400);
    assertSendable(campaign);
    const total = await prepareCampaign(campaign);
    if (total === 0) {
        campaign.status = 'draft';
        await campaign.save();
        throw new AppError('This audience has no subscribed contacts', 400);
    }
    // Kick off the first batch now; the worker continues the rest
    sendCampaignBatch(campaign._id).catch((e) => console.error('[campaign] first batch failed', e));
    res.json({ success: true, data: { totalRecipients: total }, message: `Sending to ${total} contacts` });
});

export const scheduleCampaign = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    if (!['draft', 'scheduled'].includes(campaign.status)) throw new AppError(`A ${campaign.status} campaign can't be scheduled`, 400);
    const when = new Date(req.body?.scheduledFor);
    if (isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) throw new AppError('Pick a time at least one minute in the future', 400);
    assertSendable(campaign);
    campaign.status = 'scheduled';
    campaign.scheduledFor = when;
    await campaign.save();
    res.json({ success: true, data: campaign, message: 'Campaign scheduled' });
});

export const unscheduleCampaign = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    if (campaign.status !== 'scheduled') throw new AppError('Campaign is not scheduled', 400);
    campaign.status = 'draft';
    campaign.scheduledFor = undefined;
    await campaign.save();
    res.json({ success: true, data: campaign });
});

export const pauseCampaign = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    if (campaign.status !== 'sending') throw new AppError('Only a sending campaign can be paused', 400);
    campaign.status = 'paused';
    await campaign.save();
    res.json({ success: true, data: campaign });
});

export const resumeCampaign = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    if (campaign.status !== 'paused') throw new AppError('Only a paused campaign can be resumed', 400);
    campaign.status = 'sending';
    campaign.lastError = undefined;
    await campaign.save();
    sendCampaignBatch(campaign._id).catch((e) => console.error('[campaign] resume batch failed', e));
    res.json({ success: true, data: campaign });
});

export const cancelCampaign = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    if (!['sending', 'paused', 'scheduled'].includes(campaign.status)) throw new AppError('Nothing to cancel', 400);
    campaign.status = 'cancelled';
    await campaign.save();
    await CampaignRecipient.updateMany({ campaignId: campaign._id, status: 'pending' }, { status: 'skipped' });
    res.json({ success: true, data: campaign });
});

export const campaignStats = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    const s = campaign.stats;
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
    const topLinks = await CampaignRecipient.aggregate([
        { $match: { campaignId: campaign._id } },
        { $unwind: '$clicks' },
        { $group: { _id: '$clicks.url', clicks: { $sum: 1 }, people: { $addToSet: '$_id' } } },
        { $project: { url: '$_id', clicks: 1, uniqueClicks: { $size: '$people' } } },
        { $sort: { clicks: -1 } },
        { $limit: 10 },
    ]);
    const pending = await CampaignRecipient.countDocuments({ campaignId: campaign._id, status: 'pending' });
    res.json({
        success: true,
        data: {
            ...s,
            pending,
            deliveryRate: pct(s.delivered, s.totalRecipients),
            openRate: pct(s.opened, s.delivered),
            clickRate: pct(s.clicked, s.delivered),
            clickToOpenRate: pct(s.clicked, s.opened),
            unsubscribeRate: pct(s.unsubscribed, s.delivered),
            topLinks,
        },
    });
});

export const campaignRecipients = asyncHandler(async (req: Request, res: Response) => {
    const { campaign } = await loadCampaign(req);
    const { page, limit, skip } = pageParams(req);
    const filter: Record<string, any> = { campaignId: campaign._id };
    if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status;
    const [items, total] = await Promise.all([
        CampaignRecipient.find(filter).select('-token').sort({ updatedAt: -1 }).skip(skip).limit(limit),
        CampaignRecipient.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// ============================================================================
// Templates
// ============================================================================

export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const filter: Record<string, any> = { projectId: project._id };
    if (typeof req.query.category === 'string' && req.query.category) filter.category = req.query.category;
    res.json({ success: true, data: await EmailTemplate.find(filter).sort({ updatedAt: -1 }) });
});

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
    const t = await EmailTemplate.findOne({ _id: req.params.id, projectId: project._id });
    if (!t) throw new AppError('Template not found', 404);
    res.json({ success: true, data: t });
});

const templateFields = (b: any) => {
    const out: Record<string, any> = {};
    for (const k of ['name', 'subject', 'body', 'category', 'isActive']) if (b[k] !== undefined) out[k] = b[k];
    if (b.body !== undefined) {
        out.variables = [...new Set(Array.from(String(b.body).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)).map((m) => m[1]))];
    }
    return out;
};

export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    const fields = templateFields(req.body || {});
    if (!fields.name || !fields.subject || !fields.body) throw new AppError('Name, subject and body are required', 400);
    const t = await EmailTemplate.create({ ...fields, projectId: project._id, createdBy: req.user?._id });
    res.status(201).json({ success: true, data: t });
});

export const updateTemplate = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
    const t = await EmailTemplate.findOneAndUpdate({ _id: req.params.id, projectId: project._id }, templateFields(req.body || {}), { new: true, runValidators: true });
    if (!t) throw new AppError('Template not found', 404);
    res.json({ success: true, data: t });
});

export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
    await EmailTemplate.deleteOne({ _id: req.params.id, projectId: project._id });
    res.json({ success: true, message: 'Template deleted' });
});

export const testTemplate = asyncHandler(async (req: Request, res: Response) => {
    const project = await loadProject(req);
    if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
    const t = await EmailTemplate.findOne({ _id: req.params.id, projectId: project._id });
    if (!t) throw new AppError('Template not found', 404);
    const to = String(req.body?.to || '').trim().toLowerCase();
    if (!isEmail(to)) throw new AppError('A valid recipient is required', 400);
    const { subject, body } = (t as any).replaceVariables(req.body?.variables || {});
    try {
        await mailerService.send({ projectId: project._id, category: 'transactional', throwOnError: true, to, subject: `[TEST] ${subject}`, html: body });
    } catch (err: any) {
        throw new AppError(`Test send failed: ${err.message}`, 400);
    }
    res.json({ success: true, message: `Test sent to ${to}` });
});
