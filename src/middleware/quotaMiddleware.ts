import { Request, Response, NextFunction } from 'express';
import { Subscription } from '../models/Subscription';
import { Project } from '../models/Project';
import { Content } from '../models/Content';
import { TeamMember } from '../models/TeamMember.js';
import { Tenant } from '../models/Tenant.js';
import { Plan } from '../models/Plan.js';
import { defaultPlanLimits, planSlugFor, PlanLimits } from '../config/defaultPlans.js';

const quotaCache = new Map<string, { over: boolean; limit: number; until: number }>();
const GB = 1024 * 1024 * 1024;
const PAID_STATUSES = ['active', 'trialing', 'past_due'];

interface EffectivePlan {
  limits: PlanLimits;
  /** Paid Stripe subscription, when one is active. */
  subscription?: any;
  tenant?: any;
}

/**
 * The plan a workspace is actually on. An active Stripe subscription wins;
 * otherwise the workspace's own plan (every signup starts on Free), read from
 * the plans collection with the built-in catalogue as a fallback. A missing
 * Stripe subscription is never a reason to block a free workspace.
 */
export async function resolveEffectivePlan(tenantId: unknown): Promise<EffectivePlan> {
  const [subscription, tenant] = await Promise.all([
    Subscription.findOne({ tenantId }).populate('planId'),
    Tenant.findById(tenantId).select('subscription.plan usage').lean(),
  ]);
  const paidLimits = subscription && PAID_STATUSES.includes(subscription.status) && (subscription.planId as any)?.limits;
  if (paidLimits) return { limits: paidLimits, subscription, tenant };
  const slug = planSlugFor((tenant as any)?.subscription?.plan);
  const plan = await Plan.findOne({ slug }).select('limits').lean();
  return { limits: (plan as any)?.limits || defaultPlanLimits(slug), tenant };
}

const unlimited = (n: number) => n < 0 || n >= 999999;

const limitReached = (res: Response, what: string, current: number | string, limit: number | string, message: string) =>
  res.status(403).json({ success: false, error: `${what} limit reached`, message, current, limit, upgradeUrl: '/dashboard/billing' });

/** Count one API call: paid subscriptions meter on the subscription, free workspaces on the tenant. */
async function meterApiCall(tenantId: string): Promise<{ used: number; limit: number } | null> {
  const sub: any = await Subscription.findOneAndUpdate(
    { tenantId, status: { $in: PAID_STATUSES } },
    { $inc: { 'usage.apiCallsThisMonth': 1 } },
    { new: true, projection: { 'usage.apiCallsThisMonth': 1, planId: 1 } }
  ).populate('planId', 'limits.apiCallsPerMonth').lean();
  if (sub?.planId?.limits) return { used: sub.usage.apiCallsThisMonth, limit: sub.planId.limits.apiCallsPerMonth };

  const month = new Date().toISOString().slice(0, 7);
  const projection = { 'usage.apiCalls': 1, 'subscription.plan': 1 };
  let tenant: any = await Tenant.findOneAndUpdate(
    { _id: tenantId, 'usage.currentMonth': month },
    { $inc: { 'usage.apiCalls': 1 } },
    { new: true, projection }
  ).lean();
  if (!tenant) {
    // First call of a new month resets the counter
    tenant = await Tenant.findOneAndUpdate(
      { _id: tenantId },
      { $set: { 'usage.currentMonth': month, 'usage.apiCalls': 1 } },
      { new: true, projection }
    ).lean();
  }
  if (!tenant) return null;
  const slug = planSlugFor(tenant.subscription?.plan);
  const plan: any = await Plan.findOne({ slug }).select('limits.apiCallsPerMonth').lean();
  return { used: tenant.usage.apiCalls, limit: plan?.limits?.apiCallsPerMonth ?? defaultPlanLimits(slug).apiCallsPerMonth };
}

export class QuotaMiddleware {
  // Check if tenant can create project
  static async checkProjectQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.user!.tenantId;
      const { limits } = await resolveEffectivePlan(tenantId);
      const current = await Project.countDocuments({ tenantId });
      if (!unlimited(limits.projects) && current >= limits.projects) {
        limitReached(res, 'Project', current, limits.projects,
          `Your plan allows ${limits.projects} project${limits.projects === 1 ? '' : 's'}. Upgrade to create more.`);
        return;
      }
      return next();
    } catch (error) {
      next(error);
    }
  }

  // Check if tenant can create content
  static async checkContentQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.user!.tenantId;
      const { limits } = await resolveEffectivePlan(tenantId);
      const current = await Content.countDocuments({ tenantId });
      if (!unlimited(limits.contentItems) && current >= limits.contentItems) {
        limitReached(res, 'Content', current, limits.contentItems,
          `Your plan allows ${limits.contentItems} content items. Upgrade to create more.`);
        return;
      }
      return next();
    } catch (error) {
      next(error);
    }
  }

  // Check if tenant can invite team member
  static async checkTeamMemberQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.user!.tenantId;
      const { limits } = await resolveEffectivePlan(tenantId);
      const current = await TeamMember.countDocuments({ tenantId });
      if (!unlimited(limits.teamMembers) && current >= limits.teamMembers) {
        limitReached(res, 'Team member', current, limits.teamMembers,
          `Your plan allows ${limits.teamMembers} team members. Upgrade to add more.`);
        return;
      }
      return next();
    } catch (error) {
      next(error);
    }
  }

  // Check storage quota (usage is tracked on the tenant by the media controller)
  static async checkStorageQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.user!.tenantId;
      const { limits, tenant } = await resolveEffectivePlan(tenantId);
      const fileSize = req.file?.size || 0;
      const current = tenant?.usage?.storageUsed || 0;
      if (!unlimited(limits.storage) && current + fileSize > limits.storage * GB) {
        limitReached(res, 'Storage', (current / GB).toFixed(2) + 'GB', limits.storage + 'GB',
          `Your plan allows ${limits.storage}GB storage. Upgrade for more space.`);
        return;
      }
      return next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Meter API calls against the plan's monthly allowance.
   *
   * Mounted on authenticated routers (after the tenant is known — never from a
   * client-supplied header). Counting is a single atomic $inc after the
   * response; enforcement uses a short-lived cache so the hot path does no
   * extra DB reads.
   */
  static async checkAPIRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    const tenantId = req.tenantId ? String(req.tenantId) : undefined;
    if (!tenantId) return next();

    const cached = quotaCache.get(tenantId);
    if (cached && cached.until > Date.now() && cached.over) {
      res.status(429).json({
        success: false,
        error: 'API call limit reached',
        message: `Your plan allows ${cached.limit.toLocaleString()} API calls per month. Upgrade for more.`,
        limit: cached.limit,
        upgradeUrl: '/dashboard/billing',
      });
      return;
    }

    res.on('finish', () => {
      if (res.statusCode >= 500) return;
      meterApiCall(tenantId)
        .then((r) => {
          if (r && r.limit > 0 && !unlimited(r.limit)) {
            quotaCache.set(tenantId, { over: r.used >= r.limit, limit: r.limit, until: Date.now() + 60_000 });
          }
        })
        .catch(() => undefined);
    });
    return next();
  }

  // Get quota status
  static async getQuotaStatus(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.user!.tenantId;
      const { limits, subscription, tenant } = await resolveEffectivePlan(tenantId);

      const [projectCount, contentCount, teamMemberCount] = await Promise.all([
        Project.countDocuments({ tenantId }),
        Content.countDocuments({ tenantId }),
        TeamMember.countDocuments({ tenantId }),
      ]);
      const storage = tenant?.usage?.storageUsed || 0;
      const month = new Date().toISOString().slice(0, 7);
      const apiCalls = subscription
        ? subscription.usage?.apiCallsThisMonth || 0
        : tenant?.usage?.currentMonth === month ? tenant.usage.apiCalls || 0 : 0;
      const row = (current: number, limit: number) => ({
        current,
        limit,
        percentage: limit > 0 ? (current / limit) * 100 : 0,
        remaining: limit - current,
      });

      res.json({
        projects: row(projectCount, limits.projects),
        contentItems: row(contentCount, limits.contentItems),
        teamMembers: row(teamMemberCount, limits.teamMembers),
        storage: {
          current: (storage / GB).toFixed(2) + 'GB',
          limit: limits.storage + 'GB',
          percentage: limits.storage > 0 ? (storage / (limits.storage * GB)) * 100 : 0,
          remaining: ((limits.storage * GB - storage) / GB).toFixed(2) + 'GB',
        },
        apiCalls: row(apiCalls, limits.apiCallsPerMonth),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

// Export middleware functions
export const checkProjectQuota = QuotaMiddleware.checkProjectQuota;
export const checkContentQuota = QuotaMiddleware.checkContentQuota;
export const checkTeamMemberQuota = QuotaMiddleware.checkTeamMemberQuota;
export const checkStorageQuota = QuotaMiddleware.checkStorageQuota;
export const checkAPIRateLimit = QuotaMiddleware.checkAPIRateLimit;
export const getQuotaStatus = QuotaMiddleware.getQuotaStatus;
