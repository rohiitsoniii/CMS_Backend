import { Request, Response, NextFunction } from 'express';
import { Subscription } from '../models/Subscription';
import { Plan } from '../models/Plan';
import { Project } from '../models/Project';
import { Content } from '../models/Content';
import { TeamMember } from '../models/TeamMember';

export class QuotaMiddleware {
  // Check if tenant can create project
  static async checkProjectQuota(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.user!.tenantId;
      
      const subscription = await Subscription.findOne({ tenantId }).populate('planId');
      if (!subscription) {
        return res.status(403).json({
          error: 'No active subscription',
          message: 'Please subscribe to a plan to create projects',
          upgradeUrl: '/billing/plans'
        });
      }

      const plan = subscription.planId as any;
      const currentProjects = await Project.countDocuments({ tenantId });

      if (currentProjects >= plan.limits.projects) {
        return res.status(403).json({
          error: 'Project limit reached',
          message: `Your plan allows ${plan.limits.projects} projects. Upgrade to create more.`,
          current: currentProjects,
          limit: plan.limits.projects,
          upgradeUrl: '/billing/upgrade'
        });
      }

      next();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // Check if tenant can create content
  static async checkContentQuota(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.user!.tenantId;
      
      const subscription = await Subscription.findOne({ tenantId }).populate('planId');
      if (!subscription) {
        return res.status(403).json({
          error: 'No active subscription',
          upgradeUrl: '/billing/plans'
        });
      }

      const plan = subscription.planId as any;
      const currentContent = await Content.countDocuments({ tenantId });

      if (currentContent >= plan.limits.contentItems) {
        return res.status(403).json({
          error: 'Content limit reached',
          message: `Your plan allows ${plan.limits.contentItems} content items. Upgrade to create more.`,
          current: currentContent,
          limit: plan.limits.contentItems,
          upgradeUrl: '/billing/upgrade'
        });
      }

      next();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // Check if tenant can invite team member
  static async checkTeamMemberQuota(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.user!.tenantId;
      
      const subscription = await Subscription.findOne({ tenantId }).populate('planId');
      if (!subscription) {
        return res.status(403).json({
          error: 'No active subscription',
          upgradeUrl: '/billing/plans'
        });
      }

      const plan = subscription.planId as any;
      const currentMembers = await TeamMember.countDocuments({ tenantId });

      if (currentMembers >= plan.limits.teamMembers) {
        return res.status(403).json({
          error: 'Team member limit reached',
          message: `Your plan allows ${plan.limits.teamMembers} team members. Upgrade to add more.`,
          current: currentMembers,
          limit: plan.limits.teamMembers,
          upgradeUrl: '/billing/upgrade'
        });
      }

      next();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // Check storage quota
  static async checkStorageQuota(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.user!.tenantId;
      
      const subscription = await Subscription.findOne({ tenantId }).populate('planId');
      if (!subscription) {
        return res.status(403).json({
          error: 'No active subscription',
          upgradeUrl: '/billing/plans'
        });
      }

      const plan = subscription.planId as any;
      const fileSize = req.file?.size || 0;
      const currentStorage = subscription.usage.storage;
      const maxStorage = plan.limits.storage * 1024 * 1024 * 1024; // Convert GB to bytes

      if (currentStorage + fileSize > maxStorage) {
        return res.status(403).json({
          error: 'Storage limit reached',
          message: `Your plan allows ${plan.limits.storage}GB storage. Upgrade for more space.`,
          current: (currentStorage / (1024 * 1024 * 1024)).toFixed(2) + 'GB',
          limit: plan.limits.storage + 'GB',
          upgradeUrl: '/billing/upgrade'
        });
      }

      next();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // Check API rate limit
  static async checkAPIRateLimit(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.user?.tenantId || req.headers['x-tenant-id'] as string;
      if (!tenantId) return next();
      
      const subscription = await Subscription.findOne({ tenantId }).populate('planId');
      if (!subscription) return next();

      const plan = subscription.planId as any;
      
      // Check monthly API calls
      if (subscription.usage.apiCallsThisMonth >= plan.limits.apiCallsPerMonth) {
        return res.status(429).json({
          error: 'API call limit reached',
          message: `Your plan allows ${plan.limits.apiCallsPerMonth} API calls per month. Upgrade for more.`,
          current: subscription.usage.apiCallsThisMonth,
          limit: plan.limits.apiCallsPerMonth,
          upgradeUrl: '/billing/upgrade'
        });
      }

      // Increment API call count
      subscription.usage.apiCallsThisMonth += 1;
      await subscription.save();

      next();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // Get quota status
  static async getQuotaStatus(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      
      const subscription = await Subscription.findOne({ tenantId }).populate('planId');
      if (!subscription) {
        return res.status(404).json({ error: 'No subscription found' });
      }

      const plan = subscription.planId as any;
      
      const [projectCount, contentCount, teamMemberCount] = await Promise.all([
        Project.countDocuments({ tenantId }),
        Content.countDocuments({ tenantId }),
        TeamMember.countDocuments({ tenantId })
      ]);

      const quotaStatus = {
        projects: {
          current: projectCount,
          limit: plan.limits.projects,
          percentage: (projectCount / plan.limits.projects) * 100,
          remaining: plan.limits.projects - projectCount
        },
        contentItems: {
          current: contentCount,
          limit: plan.limits.contentItems,
          percentage: (contentCount / plan.limits.contentItems) * 100,
          remaining: plan.limits.contentItems - contentCount
        },
        teamMembers: {
          current: teamMemberCount,
          limit: plan.limits.teamMembers,
          percentage: (teamMemberCount / plan.limits.teamMembers) * 100,
          remaining: plan.limits.teamMembers - teamMemberCount
        },
        storage: {
          current: (subscription.usage.storage / (1024 * 1024 * 1024)).toFixed(2) + 'GB',
          limit: plan.limits.storage + 'GB',
          percentage: (subscription.usage.storage / (plan.limits.storage * 1024 * 1024 * 1024)) * 100,
          remaining: ((plan.limits.storage * 1024 * 1024 * 1024 - subscription.usage.storage) / (1024 * 1024 * 1024)).toFixed(2) + 'GB'
        },
        apiCalls: {
          current: subscription.usage.apiCallsThisMonth,
          limit: plan.limits.apiCallsPerMonth,
          percentage: (subscription.usage.apiCallsThisMonth / plan.limits.apiCallsPerMonth) * 100,
          remaining: plan.limits.apiCallsPerMonth - subscription.usage.apiCallsThisMonth
        }
      };

      res.json(quotaStatus);
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
