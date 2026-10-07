import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Project } from '../models/index.js';
import { SMTPConfig } from '../models/SMTPConfig.js';
import { asyncHandler } from '../middleware/index.js';
import {
    subscribe,
    sendConfirmationEmail,
    confirmSubscription,
    recordOpen,
    recordClick,
    unsubscribeByToken,
} from '../services/emailMarketingService.js';

/**
 * Public, unauthenticated email endpoints (signup forms, tracking, unsubscribe).
 * Mounted at /api/v1/public/email.
 */

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function page(title: string, body: string): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827}
.card{background:#fff;max-width:440px;width:calc(100% - 32px);padding:32px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
h1{font-size:20px;margin:0 0 12px}p{color:#4b5563;line-height:1.5}
button{margin-top:16px;padding:10px 20px;border:0;border-radius:8px;background:#111827;color:#fff;font-size:15px;cursor:pointer}
textarea{width:100%;box-sizing:border-box;margin-top:12px;padding:8px;border:1px solid #d1d5db;border-radius:8px;font:inherit}
</style></head><body><div class="card">${body}</div></body></html>`;
}

const wantsHtml = (req: Request) =>
    !req.is('application/json') && (req.headers.accept || '').includes('text/html');

// ---------------------------------------------------------------------------
// Subscribe
// ---------------------------------------------------------------------------

export const publicSubscribe = asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const body = req.body || {};
    const html = wantsHtml(req);

    const reply = (status: number, ok: boolean, message: string, extra: Record<string, unknown> = {}) => {
        if (html) {
            res.status(status).type('html').send(page(ok ? 'Thanks!' : 'Something went wrong', `<h1>${ok ? 'Thanks!' : 'Oops'}</h1><p>${esc(message)}</p>`));
        } else {
            res.status(status).json({ success: ok, message, ...extra });
        }
    };

    // Honeypot: bots fill hidden fields; pretend success
    if (body._hp || body.website_url) return reply(200, true, 'You are subscribed.');

    if (!Types.ObjectId.isValid(projectId)) return reply(404, false, 'Unknown form');
    const project = await Project.findOne({ _id: projectId, status: { $ne: 'archived' } }).select('name tenantId');
    if (!project) return reply(404, false, 'Unknown form');

    const settings = await SMTPConfig.findOne({ projectId: project._id }).select('doubleOptIn').lean();
    const tags = Array.isArray(body.tags) ? body.tags : typeof body.tags === 'string' ? body.tags.split(',') : [];
    const customFields = body.fields && typeof body.fields === 'object' ? body.fields : {};

    try {
        const { subscriber, needsConfirmation } = await subscribe(
            project._id,
            {
                email: body.email,
                name: body.name || [body.firstName, body.lastName].filter(Boolean).join(' ') || undefined,
                phone: body.phone,
                tags,
                customFields,
                source: typeof body.source === 'string' ? body.source.slice(0, 50) : 'form',
                sourceDetail: typeof body.form === 'string' ? body.form : (req.headers.referer || '').slice(0, 500),
                utm: {
                    source: body.utm_source, medium: body.utm_medium, campaign: body.utm_campaign,
                    term: body.utm_term, content: body.utm_content,
                },
                consentIp: req.ip,
                consentText: typeof body.consent === 'string' ? body.consent : undefined,
            },
            { doubleOptIn: Boolean(settings?.doubleOptIn) }
        );

        if (needsConfirmation) {
            sendConfirmationEmail(project._id, subscriber, project.name).catch((e) => console.error('[email] confirm send failed', e));
            return reply(200, true, 'Almost done — check your inbox to confirm your subscription.', { needsConfirmation: true });
        }
        return reply(200, true, 'You are subscribed. Thank you!');
    } catch (err: any) {
        return reply(400, false, err.message || 'Could not subscribe');
    }
});

export const confirm = asyncHandler(async (req: Request, res: Response) => {
    const sub = await confirmSubscription(String(req.params.token || ''));
    res.type('html').send(
        sub
            ? page('Subscription confirmed', '<h1>You’re subscribed 🎉</h1><p>Thanks for confirming your email address.</p>')
            : page('Link expired', '<h1>Link not valid</h1><p>This confirmation link was already used or has expired.</p>')
    );
});

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------

export const unsubscribePage = asyncHandler(async (req: Request, res: Response) => {
    const token = String(req.params.token || '');
    // GET only shows a confirmation — link scanners prefetch GETs
    res.type('html').send(page('Unsubscribe', `
<h1>Unsubscribe?</h1>
<p>You will no longer receive marketing emails from this sender.</p>
<form method="post" action="${esc(token)}">
  <textarea name="reason" rows="3" placeholder="Optional: tell us why"></textarea>
  <button type="submit">Unsubscribe</button>
</form>`));
});

export const unsubscribe = asyncHandler(async (req: Request, res: Response) => {
    const token = String(req.params.token || '');
    // RFC 8058 one-click: body "List-Unsubscribe=One-Click"
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const result = await unsubscribeByToken(token, reason);
    if (req.body?.['List-Unsubscribe'] === 'One-Click') {
        res.status(result ? 200 : 404).end();
        return;
    }
    res.type('html').send(
        result
            ? page('Unsubscribed', `<h1>You’ve been unsubscribed</h1><p>${esc(result.email)} won’t receive these emails anymore.</p>`)
            : page('Link not valid', '<h1>Link not valid</h1><p>We couldn’t find this subscription.</p>')
    );
});

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export const openPixel = asyncHandler(async (req: Request, res: Response) => {
    const token = String(req.params.token || '').replace(/\.gif$/, '');
    recordOpen(token).catch(() => undefined);
    res.set({
        'Content-Type': 'image/gif',
        'Content-Length': String(PIXEL.length),
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    });
    res.end(PIXEL);
});

export const clickRedirect = asyncHandler(async (req: Request, res: Response) => {
    const url = typeof req.query.u === 'string' ? req.query.u : '';
    const sig = typeof req.query.s === 'string' ? req.query.s : undefined;
    const dest = await recordClick(String(req.params.token || ''), url, sig);
    if (!dest) {
        res.status(400).type('html').send(page('Invalid link', '<h1>Invalid link</h1><p>This link is broken or has been modified.</p>'));
        return;
    }
    res.redirect(302, dest);
});
