import { Request, Response } from 'express';
import { analyticsService } from '../services/analyticsService';
import { Analytics } from '../models/Analytics';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/index.js';

export const analyticsController = {
  getDashboard: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const stats = await analyticsService.getDashboardStats(req.user!.tenantId.toString());
    res.json(stats);
    return;
  }),

  getAPIUsage: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate as string) : new Date();
    const data = await analyticsService.getAPIUsage(req.user!.tenantId.toString(), start, end);
    res.json(data);
    return;
  }),

  getUserActivity: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate as string) : new Date();
    const data = await analyticsService.getUserActivity(req.user!.tenantId.toString(), start, end);
    res.json(data);
    return;
  }),

  getContentOperations: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate as string) : new Date();
    const data = await analyticsService.getContentOperations(req.user!.tenantId.toString(), start, end);
    res.json(data);
    return;
  }),

  getRevenueMetrics: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate as string) : new Date();
    const data = await analyticsService.getRevenueMetrics(req.user!.tenantId.toString(), start, end);
    res.json(data);
    return;
  }),

  getTopEndpoints: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { startDate, endDate, limit } = req.query;
    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate as string) : new Date();
    const limitNum = limit ? parseInt(limit as string) : 10;
    const data = await analyticsService.getTopEndpoints(req.user!.tenantId.toString(), start, end, limitNum);
    res.json(data);
    return;
  }),

  getErrorRate: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate as string) : new Date();
    const data = await analyticsService.getErrorRate(req.user!.tenantId.toString(), start, end);
    res.json(data);
    return;
  }),

  trackEvent: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { type, category, action, metadata } = req.body;
    await analyticsService.trackEvent({
      tenantId: req.user!.tenantId.toString(),
      userId: req.user!._id.toString(),
      type,
      category,
      action,
      metadata,
    });
    res.status(201).json({ message: 'Event tracked' });
    return;
  }),

  /**
   * Per-content analytics: views timeline, top referrers, weekly trend.
   * GET /admin/analytics/content/:contentId
   */
  getContentAnalytics: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { contentId } = req.params;
    const { startDate, endDate } = req.query;
    const tenantId = req.user!.tenantId.toString();

    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate as string) : new Date();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const [totalViews, viewsLast7d, viewsLast14d, viewsByDay, topReferrers] = await Promise.all([
      Analytics.countDocuments({
        tenant: tenantId,
        type: 'content_operation',
        action: 'view',
        'metadata.contentId': contentId,
        timestamp: { $gte: start, $lte: end },
      }),
      Analytics.countDocuments({
        tenant: tenantId,
        type: 'content_operation',
        action: 'view',
        'metadata.contentId': contentId,
        timestamp: { $gte: sevenDaysAgo },
      }),
      Analytics.countDocuments({
        tenant: tenantId,
        type: 'content_operation',
        action: 'view',
        'metadata.contentId': contentId,
        timestamp: { $gte: fourteenDaysAgo },
      }),
      Analytics.aggregate([
        {
          $match: {
            tenant: new mongoose.Types.ObjectId(tenantId),
            type: 'content_operation',
            action: 'view',
            'metadata.contentId': contentId,
            timestamp: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            views: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', views: 1 } },
      ]),
      Analytics.aggregate([
        {
          $match: {
            tenant: new mongoose.Types.ObjectId(tenantId),
            type: 'content_operation',
            action: 'view',
            'metadata.contentId': contentId,
            timestamp: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$metadata.referrer', 'Direct'] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 5 },
        { $project: { _id: 0, source: '$_id', count: 1 } },
      ]),
    ]);

    res.json({
      success: true,
      data: { totalViews, viewsLast7d, viewsLast14d, viewsByDay, topReferrers },
    });
    return;
  }),
};
