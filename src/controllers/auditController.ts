import { Request, Response, NextFunction } from 'express';
import { AuditLog } from '../models/index.js';
import { asyncHandler } from '../middleware/index.js';

/**
 * Get audit logs
 * GET /api/v1/audit-logs
 */
export const getAuditLogs = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { 
    page = 1, 
    limit = 20, 
    action, 
    userId, 
    resourceType, 
    resourceId,
    startDate,
    endDate
  } = req.query;

  const query: any = { tenantId: req.tenantId };
  
  if (action) query.action = String(action);
  if (userId) query['actor.userId'] = String(userId);
  if (resourceType) query['resource.type'] = String(resourceType);
  if (resourceId) query['resource.id'] = String(resourceId);
  
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate as string);
    if (endDate) query.createdAt.$lte = new Date(endDate as string);
  }

  const logs = await AuditLog.find(query)
    .sort({ createdAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit));

  const total = await AuditLog.countDocuments(query);

  res.json({
    success: true,
    data: {
      logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    }
  });
});
