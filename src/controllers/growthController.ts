import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Project } from '../models/index.js';
import { EmailAutomation, AutomationEnrollment, IAutomationStep } from '../models/EmailAutomation.js';
import { EmailCampaign } from '../models/EmailCampaign.js';
import { Form, FormSubmission, FORM_FIELD_TYPES, IFormField } from '../models/Form.js';
import { EmailSubscriber } from '../models/EmailSubscriber.js';
import { CampaignRecipient } from '../models/CampaignRecipient.js';
import { RagConversation } from '../models/index.js';
import { EndUser } from '../models/EndUser.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { assertWithinLimit, usageSummary } from '../services/usageService.js';

/**
 * Growth features (authenticated): automations, forms, contact profile, usage.
 */

const isId = (v: unknown): v is string => typeof v === 'string' && Types.ObjectId.isValid(v);

async function loadProject(req: Request) {
  const { projectId } = req.params;
  if (!isId(projectId)) throw new AppError('Invalid project id', 400);
  const project = await Project.findOne({ _id: projectId, tenantId: req.tenantId });
  if (!project) throw new AppError('Project not found', 404);
  return project;
}

// ============================================================================
// Automations
// ============================================================================

function cleanSteps(steps: unknown): IAutomationStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 20).map((s: any) => ({
    delayMinutes: Math.max(0, Math.min(525_600, Math.round(Number(s?.delayMinutes) || 0))),
    subject: String(s?.subject || '').slice(0, 300),
    previewText: s?.previewText ? String(s.previewText).slice(0, 300) : undefined,
    htmlContent: String(s?.htmlContent || ''),
    campaignId: isId(String(s?.campaignId || '')) ? s.campaignId : undefined,
  }));
}

function cleanTrigger(t: any) {
  const type = t?.type;
  if (!['subscribed', 'tag_added', 'form_submitted', 'content_published'].includes(type)) throw new AppError('Choose a trigger', 400);
  const out: Record<string, unknown> = { type };
  if (type === 'tag_added') {
    if (!t.tag) throw new AppError('Choose the tag that starts this automation', 400);
    out.tag = String(t.tag).toLowerCase().trim();
  }
  if (type === 'form_submitted') {
    if (!isId(t.formId)) throw new AppError('Choose a form', 400);
    out.formId = t.formId;
  }
  if (type === 'content_published') {
    out.contentTypes = Array.isArray(t.contentTypes) ? t.contentTypes.map(String).slice(0, 20) : [];
    out.segmentId = isId(t.segmentId) ? t.segmentId : undefined;
    out.sendMode = t.sendMode === 'send' ? 'send' : 'draft';
  }
  return out;
}

export const listAutomations = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  res.json({ success: true, data: await EmailAutomation.find({ projectId: project._id }).sort({ createdAt: -1 }) });
});

export const getAutomation = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
  const a = await EmailAutomation.findOne({ _id: req.params.id, projectId: project._id });
  if (!a) throw new AppError('Automation not found', 404);
  const stepStats = await EmailCampaign.find({ _id: { $in: a.steps.map((s) => s.campaignId).filter(Boolean) } }).select('stats').lean();
  const statsById = new Map(stepStats.map((c) => [String(c._id), c.stats]));
  const [active, completed, exited] = await Promise.all(['active', 'completed', 'exited'].map((status) => AutomationEnrollment.countDocuments({ automationId: a._id, status })));
  res.json({
    success: true,
    data: {
      automation: a,
      enrollments: { active, completed, exited },
      steps: a.steps.map((s) => ({ ...(s as any).toObject?.() ?? s, stats: s.campaignId ? statsById.get(String(s.campaignId)) : undefined })),
    },
  });
});

export const createAutomation = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  const { name, trigger, steps, fromName } = req.body || {};
  if (!name) throw new AppError('Name is required', 400);
  const a = await EmailAutomation.create({
    projectId: project._id,
    tenantId: project.tenantId,
    name,
    status: 'draft',
    trigger: cleanTrigger(trigger),
    steps: cleanSteps(steps),
    fromName,
    createdBy: req.user?._id,
  });
  res.status(201).json({ success: true, data: a });
});

export const updateAutomation = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
  const a = await EmailAutomation.findOne({ _id: req.params.id, projectId: project._id });
  if (!a) throw new AppError('Automation not found', 404);
  const { name, trigger, steps, fromName, status } = req.body || {};
  if (name !== undefined) a.name = name;
  if (trigger !== undefined) a.trigger = cleanTrigger(trigger) as any;
  if (steps !== undefined) {
    // Keep each step's tracking campaign when the step stays in place
    const next = cleanSteps(steps);
    next.forEach((s, i) => { if (!s.campaignId && a.steps[i]?.campaignId) s.campaignId = a.steps[i].campaignId; });
    a.steps = next;
  }
  if (fromName !== undefined) a.fromName = fromName;
  if (status !== undefined) {
    if (!['draft', 'active', 'paused'].includes(status)) throw new AppError('Invalid status', 400);
    if (status === 'active') {
      if (!a.steps.length) throw new AppError('Add at least one email first', 400);
      if (a.steps.some((s) => !s.subject.trim() || !s.htmlContent.trim())) throw new AppError('Every email needs a subject and content', 400);
      if (a.status !== 'active') await assertWithinLimit(project.tenantId, 'automations');
    }
    a.status = status;
  }
  await a.save();
  res.json({ success: true, data: a });
});

export const deleteAutomation = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
  const a = await EmailAutomation.findOneAndDelete({ _id: req.params.id, projectId: project._id });
  if (!a) throw new AppError('Automation not found', 404);
  await AutomationEnrollment.deleteMany({ automationId: a._id });
  res.json({ success: true, message: 'Automation deleted' });
});

// ============================================================================
// Forms
// ============================================================================

function cleanFields(fields: unknown): IFormField[] {
  if (!Array.isArray(fields)) return [];
  const seen = new Set<string>();
  return fields.slice(0, 50).map((f: any, i: number) => {
    let key = String(f?.key || f?.label || `field_${i + 1}`).replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-zA-Z]+/, '').slice(0, 50) || `field_${i + 1}`;
    while (seen.has(key)) key = `${key}_${i}`;
    seen.add(key);
    const type = FORM_FIELD_TYPES.includes(f?.type) ? f.type : 'text';
    return {
      key,
      label: String(f?.label || key).slice(0, 200),
      type,
      required: Boolean(f?.required),
      placeholder: f?.placeholder ? String(f.placeholder).slice(0, 200) : undefined,
      helpText: f?.helpText ? String(f.helpText).slice(0, 300) : undefined,
      options: ['select', 'radio', 'checkbox'].includes(type) && Array.isArray(f?.options) ? f.options.map(String).filter(Boolean).slice(0, 50) : undefined,
      defaultValue: f?.defaultValue ? String(f.defaultValue).slice(0, 500) : undefined,
      maxLength: f?.maxLength ? Math.min(10_000, Number(f.maxLength)) : undefined,
    };
  });
}

function cleanFormSettings(s: any = {}) {
  const emails = (Array.isArray(s.notifyEmails) ? s.notifyEmails : String(s.notifyEmails || '').split(/[\s,;]+/))
    .map((e: string) => e.trim().toLowerCase()).filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 10);
  if (s.redirectUrl && !/^https?:\/\//.test(s.redirectUrl)) throw new AppError('Redirect URL must start with http(s)://', 400);
  return {
    submitLabel: String(s.submitLabel || 'Send').slice(0, 60),
    successMessage: String(s.successMessage || 'Thanks! We received your message.').slice(0, 500),
    redirectUrl: s.redirectUrl || undefined,
    notifyEmails: emails,
    addToAudience: Boolean(s.addToAudience),
    audienceTags: (Array.isArray(s.audienceTags) ? s.audienceTags : String(s.audienceTags || '').split(',')).map((t: string) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10),
    autoReply: s.autoReply?.enabled
      ? { enabled: true, subject: String(s.autoReply.subject || 'Thanks for getting in touch').slice(0, 200), body: String(s.autoReply.body || '').slice(0, 20_000) }
      : { enabled: false },
  };
}

export const listForms = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  const forms = await Form.find({ projectId: project._id }).sort({ createdAt: -1 }).lean();
  const unread = await FormSubmission.aggregate([
    { $match: { projectId: project._id, status: 'new' } },
    { $group: { _id: '$formId', n: { $sum: 1 } } },
  ]);
  const byForm = new Map(unread.map((u) => [String(u._id), u.n]));
  res.json({ success: true, data: forms.map((f) => ({ ...f, unread: byForm.get(String(f._id)) || 0 })) });
});

export const getForm = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
  const form = await Form.findOne({ _id: req.params.id, projectId: project._id });
  if (!form) throw new AppError('Form not found', 404);
  res.json({ success: true, data: form });
});

export const createForm = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  await assertWithinLimit(project.tenantId, 'forms');
  const { name, description, fields, settings } = req.body || {};
  if (!name) throw new AppError('Form name is required', 400);
  const form = await Form.create({
    projectId: project._id,
    tenantId: project.tenantId,
    name,
    description,
    fields: cleanFields(fields?.length ? fields : [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'message', label: 'Message', type: 'textarea', required: true },
    ]),
    settings: cleanFormSettings(settings),
    createdBy: req.user?._id,
  });
  res.status(201).json({ success: true, data: form });
});

export const updateForm = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
  const form = await Form.findOne({ _id: req.params.id, projectId: project._id });
  if (!form) throw new AppError('Form not found', 404);
  const { name, description, fields, settings, status } = req.body || {};
  if (name !== undefined) form.name = name;
  if (description !== undefined) form.description = description;
  if (fields !== undefined) form.fields = cleanFields(fields);
  if (settings !== undefined) form.settings = cleanFormSettings(settings) as any;
  if (status !== undefined) form.status = status === 'paused' ? 'paused' : 'active';
  await form.save();
  res.json({ success: true, data: form });
});

export const deleteForm = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
  const form = await Form.findOneAndDelete({ _id: req.params.id, projectId: project._id });
  if (!form) throw new AppError('Form not found', 404);
  await FormSubmission.deleteMany({ formId: form._id });
  res.json({ success: true, message: 'Form and its submissions deleted' });
});

export const listSubmissions = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  const filter: Record<string, unknown> = { projectId: project._id };
  if (isId(req.query.formId)) filter.formId = req.query.formId;
  if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status;
  else filter.status = { $ne: 'spam' };
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));
  const [items, total] = await Promise.all([
    FormSubmission.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('formId', 'name'),
    FormSubmission.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const updateSubmission = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
  const status = req.body?.status;
  if (!['new', 'read', 'archived', 'spam'].includes(status)) throw new AppError('Invalid status', 400);
  const sub = await FormSubmission.findOneAndUpdate({ _id: req.params.id, projectId: project._id }, { status }, { new: true });
  if (!sub) throw new AppError('Submission not found', 404);
  res.json({ success: true, data: sub });
});

export const deleteSubmission = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
  await FormSubmission.deleteOne({ _id: req.params.id, projectId: project._id });
  res.json({ success: true });
});

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const exportSubmissions = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
  const form = await Form.findOne({ _id: req.params.id, projectId: project._id });
  if (!form) throw new AppError('Form not found', 404);
  const subs = await FormSubmission.find({ formId: form._id, status: { $ne: 'spam' } }).sort({ createdAt: -1 }).limit(50_000).lean();
  const keys = form.fields.map((f) => f.key);
  const lines = [['submitted_at', ...keys, 'page'].map(csvCell).join(',')].concat(
    subs.map((s) => [new Date(s.createdAt).toISOString(), ...keys.map((k) => (s.data as any)?.[k]), s.meta?.page].map(csvCell).join(','))
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${form.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-submissions.csv"`);
  res.send(lines.join('\n'));
});

// ============================================================================
// Unified contact profile
// ============================================================================

export const contactProfile = asyncHandler(async (req: Request, res: Response) => {
  const project = await loadProject(req);
  if (!isId(req.params.id)) throw new AppError('Invalid id', 400);
  const sub = await EmailSubscriber.findOne({ _id: req.params.id, projectId: project._id });
  if (!sub) throw new AppError('Contact not found', 404);

  const [emails, submissions, conversations, account, automations] = await Promise.all([
    CampaignRecipient.find({ projectId: project._id, email: sub.email, sentAt: { $exists: true } })
      .sort({ sentAt: -1 }).limit(50).populate('campaignId', 'name subject').select('-token').lean(),
    FormSubmission.find({ projectId: project._id, email: sub.email }).sort({ createdAt: -1 }).limit(50).populate('formId', 'name').lean(),
    RagConversation.find({ projectId: project._id, visitorEmail: sub.email }).sort({ createdAt: -1 }).limit(20).select('messages createdAt botId').lean(),
    EndUser.findOne({ projectId: project._id, email: sub.email }).select('firstName lastName status createdAt lastLoginAt emailVerified').lean(),
    AutomationEnrollment.find({ projectId: project._id, subscriberId: sub._id }).populate('automationId', 'name').lean(),
  ]);

  const timeline = [
    { at: sub.createdAt, kind: 'subscribed', text: `Joined via ${sub.source}${sub.sourceDetail ? ` (${sub.sourceDetail})` : ''}` },
    ...emails.flatMap((e: any) => [
      { at: e.sentAt, kind: 'email_sent', text: `Received “${e.campaignId?.subject || e.campaignId?.name || 'email'}”` },
      ...(e.openedAt ? [{ at: e.openedAt, kind: 'email_opened', text: `Opened “${e.campaignId?.subject || 'email'}”` }] : []),
      ...(e.clicks || []).slice(0, 5).map((c: any) => ({ at: c.clickedAt, kind: 'email_clicked', text: `Clicked ${c.url}` })),
    ]),
    ...submissions.map((s: any) => ({ at: s.createdAt, kind: 'form', text: `Submitted “${s.formId?.name || 'form'}”` })),
    ...conversations.map((c: any) => ({ at: c.createdAt, kind: 'chat', text: `Chatted with the bot (${c.messages?.length || 0} messages)` })),
    ...(sub.unsubscribedAt ? [{ at: sub.unsubscribedAt, kind: 'unsubscribed', text: `Unsubscribed${sub.unsubscribeReason ? `: ${sub.unsubscribeReason}` : ''}` }] : []),
  ].filter((t) => t.at).sort((a, b) => new Date(b.at as any).getTime() - new Date(a.at as any).getTime());

  res.json({
    success: true,
    data: {
      contact: sub,
      account,
      automations: automations.map((a: any) => ({ name: a.automationId?.name, status: a.status, step: a.stepIndex })),
      submissions,
      conversations: conversations.map((c: any) => ({ _id: c._id, createdAt: c.createdAt, messages: (c.messages || []).slice(-6) })),
      timeline: timeline.slice(0, 200),
    },
  });
});

// ============================================================================
// Usage
// ============================================================================

export const usage = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await usageSummary(String(req.tenantId)) });
});
