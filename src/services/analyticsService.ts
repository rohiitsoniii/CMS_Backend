import { Analytics } from '../models/Analytics';
import { Subscription } from '../models/Subscription';
import mongoose from 'mongoose';

export const analyticsService = {
  async trackEvent(data: {
    tenantId: string;
    type: 'api_call' | 'user_activity' | 'content_operation' | 'system_metric';
    category: string;
    action: string;
    metadata?: Record<string, any>;
    userId?: string;
    projectId?: string;
    apiKeyId?: string;
    endpoint?: string;
    method?: string;
    statusCode?: number;
    responseTime?: number;
    ipAddress?: string;
    userAgent?: string;
  }) {
    await Analytics.create({
      tenant: data.tenantId,
      type: data.type,
      category: data.category,
      action: data.action,
      metadata: data.metadata || {},
      userId: data.userId,
      projectId: data.projectId,
      apiKeyId: data.apiKeyId,
      endpoint: data.endpoint,
      method: data.method,
      statusCode: data.statusCode,
      responseTime: data.responseTime,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      timestamp: new Date()
    });
  },

  async getAPIUsage(tenantId: string, startDate: Date, endDate: Date) {
    const results = await Analytics.aggregate([
      {
        $match: {
          tenant: new mongoose.Types.ObjectId(tenantId),
          type: 'api_call',
          timestamp: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            endpoint: '$endpoint',
            method: '$method'
          },
          count: { $sum: 1 },
          avgResponseTime: { $avg: '$responseTime' },
          errors: {
            $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] }
          }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    return results;
  },

  async getUserActivity(tenantId: string, startDate: Date, endDate: Date) {
    const results = await Analytics.aggregate([
      {
        $match: {
          tenant: new mongoose.Types.ObjectId(tenantId),
          type: 'user_activity',
          timestamp: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            userId: '$userId',
            action: '$action'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          activeUsers: { $addToSet: '$_id.userId' },
          totalActions: { $sum: '$count' }
        }
      },
      {
        $project: {
          date: '$_id',
          activeUsers: { $size: '$activeUsers' },
          totalActions: 1
        }
      },
      { $sort: { date: 1 } }
    ]);

    return results;
  },

  async getContentOperations(tenantId: string, startDate: Date, endDate: Date) {
    const results = await Analytics.aggregate([
      {
        $match: {
          tenant: new mongoose.Types.ObjectId(tenantId),
          type: 'content_operation',
          timestamp: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            action: '$action'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    return results;
  },

  async getRevenueMetrics(tenantId: string, startDate: Date, endDate: Date) {
    const subscriptions = await Subscription.find({
      tenant: tenantId,
      createdAt: { $gte: startDate, $lte: endDate }
    }).populate('plan');

    const totalRevenue = subscriptions.reduce((sum, sub: any) => {
      return sum + (sub.plan?.price || 0);
    }, 0);

    const activeSubscriptions = await Subscription.countDocuments({
      tenant: tenantId,
      status: 'active'
    });

    const churnedSubscriptions = await Subscription.countDocuments({
      tenant: tenantId,
      status: 'canceled',
      canceledAt: { $gte: startDate, $lte: endDate }
    });

    return {
      totalRevenue,
      activeSubscriptions,
      churnedSubscriptions,
      newSubscriptions: subscriptions.length,
      mrr: totalRevenue
    };
  },

  async getTopEndpoints(tenantId: string, startDate: Date, endDate: Date, limit: number = 10) {
    const results = await Analytics.aggregate([
      {
        $match: {
          tenant: new mongoose.Types.ObjectId(tenantId),
          type: 'api_call',
          timestamp: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { endpoint: '$endpoint', method: '$method' },
          count: { $sum: 1 },
          avgResponseTime: { $avg: '$responseTime' },
          errorRate: {
            $avg: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] }
          }
        }
      },
      { $sort: { count: -1 } },
      { $limit: limit }
    ]);

    return results;
  },

  async getErrorRate(tenantId: string, startDate: Date, endDate: Date) {
    const results = await Analytics.aggregate([
      {
        $match: {
          tenant: new mongoose.Types.ObjectId(tenantId),
          type: 'api_call',
          timestamp: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          total: { $sum: 1 },
          errors: {
            $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          date: '$_id',
          total: 1,
          errors: 1,
          errorRate: {
            $multiply: [{ $divide: ['$errors', '$total'] }, 100]
          }
        }
      },
      { $sort: { date: 1 } }
    ]);

    return results;
  },

  async getDashboardStats(tenantId: string) {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [apiCalls24h, apiCalls7d, activeUsers7d, contentOps7d, revenue30d] = await Promise.all([
      Analytics.countDocuments({ tenant: tenantId, type: 'api_call', timestamp: { $gte: last24h } }),
      Analytics.countDocuments({ tenant: tenantId, type: 'api_call', timestamp: { $gte: last7d } }),
      Analytics.distinct('userId', { tenant: tenantId, type: 'user_activity', timestamp: { $gte: last7d } }),
      Analytics.countDocuments({ tenant: tenantId, type: 'content_operation', timestamp: { $gte: last7d } }),
      this.getRevenueMetrics(tenantId, last30d, now)
    ]);

    return {
      apiCalls: { last24h: apiCalls24h, last7d: apiCalls7d },
      activeUsers: activeUsers7d.length,
      contentOperations: contentOps7d,
      revenue: revenue30d
    };
  }
};
