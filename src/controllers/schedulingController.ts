/**
 * Scheduling Controller
 * 
 * Handles content scheduling endpoints
 */

import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware';
import schedulingService from '../services/schedulingService';

/**
 * Schedule content publish
 */
export const schedulePublish = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const { publishAt, recurring } = req.body;

  if (!publishAt) {
    res.status(400).json({
      success: false,
      message: 'publishAt date is required',
    }); return;
  }

  const content = await schedulingService.updateContentScheduling(id, {
    publishAt: new Date(publishAt),
    recurring,
  });

  res.json({
    success: true,
    data: { content },
    message: 'Content publish scheduled successfully',
  });
});

/**
 * Schedule content unpublish
 */
export const scheduleUnpublish = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const { unpublishAt } = req.body;

  if (!unpublishAt) {
    res.status(400).json({
      success: false,
      message: 'unpublishAt date is required',
    }); return;
  }

  const content = await schedulingService.updateContentScheduling(id, {
    unpublishAt: new Date(unpublishAt),
  });

  res.json({
    success: true,
    data: { content },
    message: 'Content unpublish scheduled successfully',
  });
});

/**
 * Update content scheduling
 */
export const updateScheduling = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const { publishAt, unpublishAt, recurring } = req.body;

  const content = await schedulingService.updateContentScheduling(id, {
    publishAt: publishAt ? new Date(publishAt) : undefined,
    unpublishAt: unpublishAt ? new Date(unpublishAt) : undefined,
    recurring,
  });

  res.json({
    success: true,
    data: { content },
    message: 'Content scheduling updated successfully',
  });
});

/**
 * Clear content scheduling
 */
export const clearScheduling = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;

  const content = await schedulingService.clearContentScheduling(id);

  res.json({
    success: true,
    data: { content },
    message: 'Content scheduling cleared successfully',
  });
});

/**
 * Get content schedule
 */
export const getContentSchedule = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;

  const schedule = schedulingService.getContentSchedule(id);

  res.json({
    success: true,
    data: { schedule },
  });
});

/**
 * Get calendar view
 */
export const getCalendarView = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    res.status(400).json({
      success: false,
      message: 'startDate and endDate are required',
    }); return;
  }

  const calendar = await schedulingService.getCalendarView(
    new Date(startDate as string),
    new Date(endDate as string)
  );

  res.json({
    success: true,
    data: { calendar },
  });
});

/**
 * Get all scheduled tasks
 */
export const getScheduledTasks = asyncHandler(async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const tasks = schedulingService.getScheduledTasks();

  res.json({
    success: true,
    data: { tasks },
  });
});

/**
 * Bulk schedule publish
 */
export const bulkSchedulePublish = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { contentIds, publishAt, recurring } = req.body;

  if (!contentIds || !Array.isArray(contentIds) || contentIds.length === 0) {
    res.status(400).json({
      success: false,
      message: 'contentIds array is required',
    }); return;
  }

  if (!publishAt) {
    res.status(400).json({
      success: false,
      message: 'publishAt date is required',
    }); return;
  }

  const results = await Promise.all(
    contentIds.map((id) =>
      schedulingService.updateContentScheduling(id, {
        publishAt: new Date(publishAt),
        recurring,
      })
    )
  );

  res.json({
    success: true,
    data: { count: results.length },
    message: `${results.length} content items scheduled successfully`,
  });
});
