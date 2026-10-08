import { Types } from 'mongoose';
import { Project, Tenant, Content, User } from '../models/index.js';
import { subscriptionPlans } from '../config/index.js';
import { EmailSubscriber } from '../models/EmailSubscriber.js';
import { SMTPConfig } from '../models/SMTPConfig.js';
import { RagConversation } from '../models/index.js';
import { SiteEvent } from '../models/SiteEvent.js';
import { Subscription } from '../models/Subscription.js';
import { getMonthlyUsage, planTokenAllowance } from './aiGateway.js';
import { platformEmailAllowance } from './mailerService.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * One place for plan limits on growth features + a usage summary for the
 * dashboard. -1 means unlimited. Override per plan with env, e.g.
 * LIMIT_CONTACTS_FREE=1000, LIMIT_BOT_MESSAGES_PRO=50000.
 */

type GrowthLimit = 'contacts' | 'botMessages' | 'forms' | 'automations' | 'analyticsEvents';

const GROWTH_LIMITS: Record<string, Record<GrowthLimit, number>> = {
  free: { contacts: 500, botMessages: 500, forms: 2, automations: 1, analyticsEvents: 20_000 },
  basic: { contacts: 5_000, botMessages: 5_000, forms: 10, automations: 5, analyticsEvents: 200_000 },
  starter: { contacts: 5_000, botMessages: 5_000, forms: 10, automations: 5, analyticsEvents: 200_000 },
  pro: { contacts: 50_000, botMessages: 50_000, forms: -1, automations: 25, analyticsEvents: 2_000_000 },
  professional: { contacts: 50_000, botMessages: 50_000, forms: -1, automations: 25, analyticsEvents: 2_000_000 },
  business: { contacts: 200_000, botMessages: 200_000, forms: -1, automations: -1, analyticsEvents: 10_000_000 },
  enterprise: { contacts: -1, botMessages: -1, forms: -1, automations: -1, analyticsEvents: -1 },
};

const ENV_KEY: Record<GrowthLimit, string> = {
  contacts: 'CONTACTS',
  botMessages: 'BOT_MESSAGES',
  forms: 'FORMS',
  automations: 'AUTOMATIONS',
  analyticsEvents: 'ANALYTICS_EVENTS',
};

export function growthLimit(plan: string | undefined, key: GrowthLimit): number {
  const p = (plan || 'free').toLowerCase();
  const env = process.env[`LIMIT_${ENV_KEY[key]}_${p.toUpperCase()}`];
  if (env !== undefined && !isNaN(Number(env))) return Number(env);
  return (GROWTH_LIMITS[p] || GROWTH_LIMITS.free)[key];
}

export async function tenantPlan(tenantId: unknown): Promise<string> {
  const t = await Tenant.findById(tenantId).select('subscription.plan').lean();
  return (t as any)?.subscription?.plan || 'free';
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

async function projectIdsOf(tenantId: unknown): Promise<Types.ObjectId[]> {
  return (await Project.find({ tenantId }).select('_id').lean()).map((p) => p._id as Types.ObjectId);
}

/** Throw 402 when adding `adding` more of a resource would exceed the plan. */
export async function assertWithinLimit(tenantId: unknown, key: GrowthLimit, adding = 1): Promise<void> {
  const plan = await tenantPlan(tenantId);
  const limit = growthLimit(plan, key);
  if (limit < 0) return;
  // Counted resources need exact numbers; high-volume metrics use the cache
  const used = await currentUsage(tenantId, key, key === 'forms' || key === 'automations' || key === 'contacts');
  if (used + adding > limit) {
    const label: Record<GrowthLimit, string> = {
      contacts: 'contacts', botMessages: 'chatbot messages this month', forms: 'forms', automations: 'automations', analyticsEvents: 'analytics events this month',
    };
    throw new AppError(`Your ${plan} plan includes ${limit.toLocaleString()} ${label[key]}. Upgrade to add more.`, 402);
  }
}

const usageCache = new Map<string, { value: number; until: number }>();

export async function currentUsage(tenantId: unknown, key: GrowthLimit, fresh = false): Promise<number> {
  const cacheKey = `${tenantId}:${key}`;
  const hit = usageCache.get(cacheKey);
  if (!fresh && hit && hit.until > Date.now()) return hit.value;
  const value = await computeUsage(tenantId, key);
  usageCache.set(cacheKey, { value, until: Date.now() + 60_000 });
  return value;
}

async function computeUsage(tenantId: unknown, key: GrowthLimit): Promise<number> {
  const projectIds = await projectIdsOf(tenantId);
  switch (key) {
    case 'contacts':
      return EmailSubscriber.countDocuments({ projectId: { $in: projectIds }, status: { $in: ['subscribed', 'pending'] } });
    case 'botMessages': {
      const [row] = await RagConversation.aggregate([
        { $match: { projectId: { $in: projectIds }, updatedAt: { $gte: monthStart() } } },
        { $unwind: '$messages' },
        { $match: { 'messages.role': 'assistant', 'messages.timestamp': { $gte: monthStart() } } },
        { $count: 'n' },
      ]);
      return row?.n || 0;
    }
    case 'forms': {
      const { Form } = await import('../models/Form.js');
      return Form.countDocuments({ projectId: { $in: projectIds } });
    }
    case 'automations': {
      const { EmailAutomation } = await import('../models/EmailAutomation.js');
      return EmailAutomation.countDocuments({ projectId: { $in: projectIds }, status: 'active' });
    }
    case 'analyticsEvents':
      return SiteEvent.countDocuments({ projectId: { $in: projectIds }, createdAt: { $gte: monthStart() } });
  }
}

/** Usage summary for the dashboard. */
export async function usageSummary(tenantId: string) {
  const plan = await tenantPlan(tenantId);
  const legacy = (subscriptionPlans as any)[plan]?.limits || (subscriptionPlans as any).free.limits;
  const tenant = await Tenant.findById(tenantId).select('usage').lean() as any;
  const projectIds = await projectIdsOf(tenantId);
  const sub = await Subscription.findOne({ tenantId }).populate('planId').lean() as any;

  const emailConfigs = await SMTPConfig.find({ projectId: { $in: projectIds } }).select('provider limits').lean();
  const platformEmails = emailConfigs
    .filter((c: any) => c.provider !== 'custom' && c.limits?.currentMonth === new Date().toISOString().slice(0, 7))
    .reduce((n: number, c: any) => n + (c.limits?.currentMonthlyCount || 0), 0);

  const ai = await getMonthlyUsage(tenantId);
  const [contacts, botMessages, forms, automations, analyticsEvents, contentItems, teamMembers] = await Promise.all([
    currentUsage(tenantId, 'contacts'),
    currentUsage(tenantId, 'botMessages'),
    currentUsage(tenantId, 'forms'),
    currentUsage(tenantId, 'automations'),
    currentUsage(tenantId, 'analyticsEvents'),
    Content.countDocuments({ tenantId, isDeleted: { $ne: true } }),
    User.countDocuments({ tenantId, isActive: { $ne: false } }),
  ]);

  const item = (label: string, used: number, limit: number, unit = '', period: 'month' | 'total' = 'total') => ({ label, used, limit, unit, period });
  return {
    plan,
    items: [
      item('Projects', projectIds.length, sub?.planId?.limits?.projects ?? -1),
      item('Content items', contentItems, sub?.planId?.limits?.contentItems ?? -1),
      item('Team members', teamMembers, legacy.teamMembers ?? -1),
      item('Storage', tenant?.usage?.storageUsed || 0, legacy.storageBytes ?? -1, 'bytes'),
      item('API calls', sub?.usage?.apiCallsThisMonth || 0, sub?.planId?.limits?.apiCallsPerMonth ?? legacy.apiCallsPerMonth ?? -1, '', 'month'),
      item('AI tokens (credits)', ai.platformTokens, planTokenAllowance(plan), 'tokens', 'month'),
      item('Marketing emails (platform server)', platformEmails, platformEmailAllowance(plan).monthlyLimit * Math.max(1, projectIds.length), '', 'month'),
      item('Contacts', contacts, growthLimit(plan, 'contacts')),
      item('Chatbot messages', botMessages, growthLimit(plan, 'botMessages'), '', 'month'),
      item('Forms', forms, growthLimit(plan, 'forms')),
      item('Active automations', automations, growthLimit(plan, 'automations')),
      item('Analytics events', analyticsEvents, growthLimit(plan, 'analyticsEvents'), '', 'month'),
    ],
    byok: { aiTokens: ai.byokTokens },
  };
}
