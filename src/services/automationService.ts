import { Types } from 'mongoose';
import { EmailAutomation, AutomationEnrollment, IEmailAutomation } from '../models/EmailAutomation.js';
import { EmailSubscriber } from '../models/EmailSubscriber.js';
import { EmailCampaign } from '../models/EmailCampaign.js';
import { CampaignRecipient } from '../models/CampaignRecipient.js';
import { SMTPConfig } from '../models/SMTPConfig.js';
import { Project } from '../models/index.js';
import { mailerService, QuotaExceededError } from './mailerService.js';
import {
  decorateHtml,
  renderMergeTags,
  unsubscribeUrl,
  newToken,
  prepareCampaign,
} from './emailMarketingService.js';
import { contentPath, siteUrlFor } from './seoPingService.js';
import { describeContent } from './geoService.js';
import { SeoSettings } from '../models/SeoSettings.js';

/**
 * Email automation engine: enrolls contacts on triggers and sends each step
 * when it is due (processed by the email worker).
 */

export interface AudienceEvent {
  type: 'subscribed' | 'tag_added' | 'form_submitted';
  subscriberId: Types.ObjectId | string;
  email: string;
  tag?: string;
  formId?: Types.ObjectId | string;
}

const SUPPRESSED = ['unsubscribed', 'bounced', 'complained'];

/** Enroll the contact in every active automation whose trigger matches. */
export async function onAudienceEvent(projectId: Types.ObjectId | string, ev: AudienceEvent): Promise<number> {
  const filter: Record<string, unknown> = { projectId, status: 'active', 'trigger.type': ev.type };
  if (ev.type === 'tag_added') filter['trigger.tag'] = String(ev.tag || '').toLowerCase();
  if (ev.type === 'form_submitted') filter['trigger.formId'] = ev.formId;
  const automations = await EmailAutomation.find(filter).select('steps').lean();

  let enrolled = 0;
  for (const a of automations) {
    if (!a.steps?.length) continue;
    try {
      await AutomationEnrollment.create({
        automationId: a._id,
        projectId,
        subscriberId: ev.subscriberId,
        email: ev.email,
        stepIndex: 0,
        nextRunAt: new Date(Date.now() + (a.steps[0].delayMinutes || 0) * 60_000),
      });
      await EmailAutomation.updateOne({ _id: a._id }, { $inc: { 'stats.enrolled': 1 } });
      enrolled++;
    } catch (err: any) {
      if (err?.code !== 11000) console.error('[automation] enroll failed:', err.message); // 11000 = already enrolled
    }
  }
  return enrolled;
}

/** Fire-and-forget wrapper for hooks. */
export function emitAudienceEvent(projectId: Types.ObjectId | string, ev: AudienceEvent) {
  onAudienceEvent(projectId, ev).catch((err) => console.error('[automation] event failed:', err?.message || err));
}

/** Hidden campaign that carries tracking + stats for one automation step. */
async function stepCampaign(a: IEmailAutomation, index: number) {
  const step = a.steps[index];
  if (step.campaignId) {
    const existing = await EmailCampaign.findById(step.campaignId);
    if (existing) {
      // Keep content in sync with edits to the step
      if (existing.subject !== step.subject || existing.htmlContent !== step.htmlContent || existing.previewText !== step.previewText) {
        existing.subject = step.subject;
        existing.htmlContent = step.htmlContent;
        existing.previewText = step.previewText;
        await existing.save();
      }
      return existing;
    }
  }
  const campaign = await EmailCampaign.create({
    projectId: a.projectId,
    tenantId: a.tenantId,
    automationId: a._id,
    name: `${a.name} — email ${index + 1}`,
    subject: step.subject,
    previewText: step.previewText,
    htmlContent: step.htmlContent,
    fromName: a.fromName || 'Newsletter',
    recipientType: 'custom',
    status: 'sent',
    createdBy: a.createdBy || a.tenantId,
  });
  a.steps[index].campaignId = campaign._id as Types.ObjectId;
  a.markModified('steps');
  await a.save();
  return campaign;
}

/** Send due automation emails. Returns number processed. */
export async function processDueEnrollments(limit = 100): Promise<number> {
  const due = await AutomationEnrollment.find({ status: 'active', nextRunAt: { $lte: new Date() } }).sort({ nextRunAt: 1 }).limit(limit);
  let processed = 0;

  for (const en of due) {
    const a = await EmailAutomation.findById(en.automationId);
    if (!a || a.status !== 'active') continue; // paused: keep waiting
    const sub = await EmailSubscriber.findById(en.subscriberId).lean();
    if (!sub || SUPPRESSED.includes(sub.status) || sub.status !== 'subscribed') {
      en.status = 'exited';
      await en.save();
      continue;
    }
    const step = a.steps[en.stepIndex];
    if (!step) {
      en.status = 'completed';
      await en.save();
      await EmailAutomation.updateOne({ _id: a._id }, { $inc: { 'stats.completed': 1 } });
      continue;
    }

    const campaign = await stepCampaign(a, en.stepIndex);
    let recipient = await CampaignRecipient.findOne({ campaignId: campaign._id, email: en.email });
    if (!recipient) {
      recipient = await CampaignRecipient.create({
        campaignId: campaign._id, projectId: a.projectId, subscriberId: sub._id, email: en.email, name: sub.name, token: newToken(), status: 'pending',
      });
    }

    if (recipient.status === 'pending') {
      const settings = await SMTPConfig.findOne({ projectId: a.projectId }).lean();
      const ctx = { email: en.email, name: sub.name, customFields: sub.customFields, unsubscribeUrl: unsubscribeUrl(recipient.token) };
      const html = decorateHtml(renderMergeTags(step.htmlContent, ctx), recipient.token, {
        trackClicks: true, trackOpens: true, previewText: step.previewText, physicalAddress: settings?.physicalAddress,
      });
      try {
        await mailerService.send({
          projectId: a.projectId,
          category: 'marketing',
          throwOnError: true,
          to: en.email,
          subject: renderMergeTags(step.subject, ctx, false),
          html,
          fromName: a.fromName || settings?.fromName,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl(recipient.token)}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        recipient.status = 'sent';
        recipient.sentAt = new Date();
        recipient.attempts += 1;
        await recipient.save();
        await EmailCampaign.updateOne({ _id: campaign._id }, { $inc: { 'stats.totalRecipients': 1, 'stats.sent': 1, 'stats.delivered': 1 } });
        await EmailAutomation.updateOne({ _id: a._id }, { $inc: { 'stats.sent': 1 } });
        await EmailSubscriber.updateOne({ _id: sub._id }, { $inc: { totalEmailsReceived: 1 }, $set: { lastEmailSentAt: new Date() } });
      } catch (err: any) {
        if (err instanceof QuotaExceededError) {
          // Retry tomorrow when the daily allowance resets
          en.nextRunAt = new Date(Date.now() + 6 * 3600_000);
          await en.save();
          continue;
        }
        recipient.attempts += 1;
        recipient.error = String(err.message || err).slice(0, 500);
        if (recipient.attempts < 3) {
          await recipient.save();
          en.nextRunAt = new Date(Date.now() + 30 * 60_000);
          await en.save();
          continue;
        }
        recipient.status = 'failed';
        await recipient.save();
      }
    }

    en.stepIndex += 1;
    const next = a.steps[en.stepIndex];
    if (next) {
      en.nextRunAt = new Date(Date.now() + (next.delayMinutes || 0) * 60_000);
    } else {
      en.status = 'completed';
      await EmailAutomation.updateOne({ _id: a._id }, { $inc: { 'stats.completed': 1 } });
    }
    await en.save();
    processed++;
  }
  return processed;
}

/**
 * "New post → newsletter": when content of a chosen type is published, create
 * (or send) a campaign from the automation's first email template.
 */
export async function onContentPublished(content: any): Promise<number> {
  if (!content?.projectId) return 0;
  const typeKey = content.contentTypeApiId || content.type;
  const automations = await EmailAutomation.find({ projectId: content.projectId, status: 'active', 'trigger.type': 'content_published' });
  let created = 0;

  for (const a of automations) {
    const types = a.trigger.contentTypes || [];
    if (types.length && !types.includes(typeKey)) continue;
    if (!a.steps[0]) continue;
    // Once per content entry
    if (await EmailCampaign.exists({ automationId: a._id, sourceContentId: content._id })) continue;

    const settings = await SeoSettings.findOne({ projectId: content.projectId });
    const site = await siteUrlFor(content.projectId, settings);
    const path = contentPath(content, settings);
    const m = describeContent(content);
    const vars: Record<string, string> = {
      post_title: m.headline || content.name,
      post_url: site && path ? `${site}${path}` : '',
      post_excerpt: m.description || '',
      post_image: m.image || '',
    };
    const fill = (t: string) => t.replace(/\{\{\s*(post_title|post_url|post_excerpt|post_image)\s*\}\}/g, (_x, k) => vars[k] || '');

    const project = await Project.findById(content.projectId).select('name').lean();
    const campaign = await EmailCampaign.create({
      projectId: a.projectId,
      tenantId: a.tenantId,
      automationId: a._id,
      sourceContentId: content._id,
      showInCampaigns: true,
      name: `${a.name}: ${vars.post_title}`.slice(0, 200),
      subject: fill(a.steps[0].subject).slice(0, 300),
      previewText: a.steps[0].previewText ? fill(a.steps[0].previewText) : vars.post_excerpt.slice(0, 200),
      htmlContent: fill(a.steps[0].htmlContent),
      fromName: a.fromName || (project as any)?.name || 'Newsletter',
      recipientType: a.trigger.segmentId ? 'segment' : 'all',
      segmentId: a.trigger.segmentId,
      status: 'draft',
      createdBy: a.createdBy || a.tenantId,
    });
    if (a.trigger.sendMode === 'send') {
      const total = await prepareCampaign(campaign);
      if (total === 0) {
        campaign.status = 'draft';
        campaign.lastError = 'No subscribed contacts in this audience';
        await campaign.save();
      }
    }
    await EmailAutomation.updateOne({ _id: a._id }, { $inc: { 'stats.sent': 1 } });
    created++;
  }
  return created;
}
