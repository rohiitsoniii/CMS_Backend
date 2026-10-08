import express, { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Types } from 'mongoose';
import { Form, FormSubmission, IForm } from '../models/Form.js';
import { SMTPConfig } from '../models/SMTPConfig.js';
import { EmailSubscriber } from '../models/EmailSubscriber.js';
import { asyncHandler } from '../middleware/index.js';
import { mailerService } from '../services/mailerService.js';
import { subscribe, sendConfirmationEmail } from '../services/emailMarketingService.js';
import { emitAudienceEvent } from '../services/automationService.js';
import { Project } from '../models/index.js';

/**
 * Public form endpoints — /api/v1/public/forms (no auth, embedded on sites).
 */
const router = Router();

const submitLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many submissions, please wait a minute.' } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

async function activeForm(formId: string) {
  if (!Types.ObjectId.isValid(formId)) return null;
  return Form.findOne({ _id: formId, status: 'active' });
}

/** Definition for rendering (no notification emails or internal settings). */
router.get('/:formId', asyncHandler(async (req: Request, res: Response) => {
  const form = await activeForm(req.params.formId);
  if (!form) {
    res.status(404).json({ success: false, message: 'Form not found' });
    return;
  }
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    success: true,
    data: {
      id: form._id,
      name: form.name,
      description: form.description,
      fields: form.fields,
      submitLabel: form.settings.submitLabel,
      successMessage: form.settings.successMessage,
      redirectUrl: form.settings.redirectUrl,
      renderedAt: Date.now(),
    },
  });
}));

function validate(form: IForm, body: Record<string, unknown>) {
  const data: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const f of form.fields) {
    let raw = body[f.key];
    if (Array.isArray(raw)) raw = raw.map(String).join(', ');
    const value = raw === undefined || raw === null ? '' : String(raw).trim();
    if (f.required && (!value || (f.type === 'consent' && !['true', 'on', '1', 'yes'].includes(value.toLowerCase())))) {
      errors[f.key] = `${f.label} is required`;
      continue;
    }
    if (!value) continue;
    const max = f.maxLength || (f.type === 'textarea' ? 5000 : 500);
    if (value.length > max) errors[f.key] = `${f.label} is too long`;
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) errors[f.key] = 'Enter a valid email address';
    if (f.type === 'url' && !/^https?:\/\//i.test(value)) errors[f.key] = 'Enter a full URL starting with http(s)://';
    if (f.type === 'number' && isNaN(Number(value))) errors[f.key] = `${f.label} must be a number`;
    if (['select', 'radio'].includes(f.type) && f.options?.length && !f.options.includes(value)) errors[f.key] = `Choose a valid ${f.label.toLowerCase()}`;
    data[f.key] = value.slice(0, max);
  }
  return { data, errors };
}

router.post('/:formId/submit', submitLimiter, express.urlencoded({ extended: true, limit: '64kb' }), asyncHandler(async (req: Request, res: Response) => {
  const form = await activeForm(req.params.formId);
  const wantsHtml = !req.is('application/json') && (req.headers.accept || '').includes('text/html');
  const reply = (status: number, body: Record<string, unknown>): void => {
    if (wantsHtml) {
      if (status < 300 && form?.settings.redirectUrl) { res.redirect(303, form.settings.redirectUrl); return; }
      res.status(status).type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;display:flex;min-height:90vh;align-items:center;justify-content:center"><p>${esc(String(body.message || ''))}</p></body>`);
      return;
    }
    res.status(status).json(body);
  };
  if (!form) return reply(404, { success: false, message: 'Form not found' });

  const body = (req.body || {}) as Record<string, unknown>;
  // Spam traps: hidden honeypot field + filled faster than a human could
  const tooFast = typeof body._t === 'string' || typeof body._t === 'number' ? Date.now() - Number(body._t) < 2000 : false;
  if (body._hp || tooFast) return reply(200, { success: true, message: form.settings.successMessage });

  const { data, errors } = validate(form, body);
  if (Object.keys(errors).length) return reply(400, { success: false, message: 'Please fix the highlighted fields', errors });

  const emailField = form.fields.find((f) => f.type === 'email');
  const email = emailField ? data[emailField.key]?.toLowerCase() : undefined;
  const page = typeof body._page === 'string' ? body._page.slice(0, 500) : req.get('referer')?.slice(0, 500);
  const utm: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) if (typeof body[k] === 'string') utm[k.slice(4)] = String(body[k]).slice(0, 150);

  const submission = await FormSubmission.create({
    formId: form._id, projectId: form.projectId, data, email,
    meta: { page, referrer: req.get('referer')?.slice(0, 500), utm, userAgent: req.get('user-agent')?.slice(0, 300) },
  });
  await Form.updateOne({ _id: form._id }, { $inc: { 'stats.submissions': 1 }, $set: { 'stats.lastSubmissionAt': new Date() } });

  // Side effects never block the visitor's response
  void (async () => {
    const project = await Project.findById(form.projectId).select('name').lean();
    if (form.settings.notifyEmails?.length) {
      const rows = form.fields.filter((f) => data[f.key]).map((f) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;vertical-align:top">${esc(f.label)}</td><td style="padding:6px 0">${esc(data[f.key]).replace(/\n/g, '<br>')}</td></tr>`).join('');
      await mailerService.send({
        projectId: form.projectId,
        category: 'transactional',
        to: form.settings.notifyEmails,
        replyTo: email,
        subject: `New ${form.name} submission`,
        html: `<div style="font-family:Arial,sans-serif"><h2 style="margin:0 0 12px">${esc(form.name)}</h2><table>${rows}</table>${page ? `<p style="color:#6b7280;font-size:12px">From ${esc(page)}</p>` : ''}</div>`,
      });
    }
    if (email && form.settings.autoReply?.enabled && form.settings.autoReply.body) {
      await mailerService.send({
        projectId: form.projectId,
        category: 'transactional',
        to: email,
        subject: form.settings.autoReply.subject || `Thanks for contacting ${(project as any)?.name || 'us'}`,
        html: form.settings.autoReply.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => esc(data[k] || '')),
      });
    }
    if (email) {
      if (form.settings.addToAudience) {
        const settings = await SMTPConfig.findOne({ projectId: form.projectId }).select('doubleOptIn').lean();
        const nameField = form.fields.find((f) => /^(name|full_?name|first_?name)$/i.test(f.key));
        const result = await subscribe(form.projectId, {
          email,
          name: nameField ? data[nameField.key] : undefined,
          tags: form.settings.audienceTags,
          source: 'form',
          sourceDetail: form.name,
          consentIp: req.ip,
          utm,
        }, { doubleOptIn: Boolean(settings?.doubleOptIn) });
        if (result.needsConfirmation) await sendConfirmationEmail(form.projectId, result.subscriber, (project as any)?.name || form.name);
      }
      const subscriber = await EmailSubscriber.findOne({ projectId: form.projectId, email }).select('_id status').lean();
      if (subscriber?.status === 'subscribed') {
        emitAudienceEvent(form.projectId, { type: 'form_submitted', subscriberId: subscriber._id, email, formId: form._id });
      }
    }
  })().catch((err) => console.error('[forms] post-submit tasks failed:', err?.message || err));

  return reply(200, { success: true, message: form.settings.successMessage, redirectUrl: form.settings.redirectUrl, id: submission._id });
}));

export default router;
