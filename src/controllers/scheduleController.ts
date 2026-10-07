import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Schedule from '../models/Schedule';
import { Content } from '../models/Content';

/**
 * Schedule Controller
 * Manages content scheduling
 */

/**
 * @route   GET /api/v1/schedules
 * @desc    Get all schedules for tenant
 * @access  Private
 */
export const getSchedules = async (req: Request, res: Response) => {
  try {
    const { status, limit = 50, skip = 0 } = req.query;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const query: any = { tenantId };
    if (status) {
      query.status = status;
    }

    const schedules = await Schedule.find(query)
      .sort({ scheduledFor: 1 })
      .limit(Number(limit))
      .skip(Number(skip))
      .populate('contentId', 'name slug')
      .populate('createdBy', 'name email');

    const total = await Schedule.countDocuments(query);

    return res.json({
      success: true,
      data: {
        schedules,
        total,
        limit: Number(limit),
        skip: Number(skip)
      }
    });
  } catch (error: any) {
    console.error('Error fetching schedules:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch schedules',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/schedules/upcoming
 * @desc    Get upcoming schedules
 * @access  Private
 */
export const getUpcomingSchedules = async (req: Request, res: Response) => {
  try {
    const { limit = 10 } = req.query;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const schedules = await (Schedule as any).findUpcoming(tenantId, Number(limit));

    return res.json({
      success: true,
      data: {
        schedules,
        total: schedules.length
      }
    });
  } catch (error: any) {
    console.error('Error fetching upcoming schedules:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch upcoming schedules',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/schedules/history
 * @desc    Get schedule history
 * @access  Private
 */
export const getScheduleHistory = async (req: Request, res: Response) => {
  try {
    const { projectId, limit = 50 } = req.query;
    const query: any = {};
    if (projectId) query.projectId = projectId;
    const schedules = await Schedule.find(query).sort({ updatedAt: -1 }).limit(Number(limit));
    return res.json({
      success: true,
      data: {
        history: schedules,
        schedules,
        total: schedules.length
      }
    });
  } catch (error: any) {
    return res.json({
      success: true,
      data: { history: [], schedules: [], total: 0 }
    });
  }
};

/**
 * @route   GET /api/v1/schedules/:id
 * @desc    Get single schedule
 * @access  Private
 */
export const getSchedule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    if (!id || id === 'history' || id === 'undefined' || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }

    const schedule = await Schedule.findOne({ _id: id, tenantId })
      .populate('contentId', 'name slug')
      .populate('createdBy', 'name email');

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }

    return res.json({
      success: true,
      data: { schedule }
    });
  } catch (error: any) {
    console.error('Error fetching schedule:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch schedule',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/schedules
 * @desc    Create new schedule
 * @access  Private
 */
export const createSchedule = async (req: Request, res: Response) => {
  try {
    const {
      contentId,
      action,
      scheduledFor,
      timezone,
      recurring,
      recurrenceRule,
      notifyOnCompletion,
      notifyUsers
    } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Validate required fields
    if (!contentId || !action || !scheduledFor) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: contentId, action, scheduledFor'
      });
    }

    // Get content
    const content = await Content.findOne({ _id: contentId, tenantId });
    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Create schedule
    const schedule = new Schedule({
      tenantId,
      contentId,
      contentType: content.contentTypeApiId || content.type,
      contentTitle: content.name,
      action,
      scheduledFor: new Date(scheduledFor),
      timezone: timezone || 'UTC',
      recurring: recurring || false,
      recurrenceRule,
      notifyOnCompletion: notifyOnCompletion || false,
      notifyUsers: notifyUsers || [],
      status: 'pending',
      createdBy: userId,
      updatedBy: userId
    });

    await schedule.save();

    return res.status(201).json({
      success: true,
      message: 'Schedule created successfully',
      data: { schedule }
    });
  } catch (error: any) {
    console.error('Error creating schedule:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create schedule',
      error: error.message
    });
  }
};

/**
 * @route   PUT /api/v1/schedules/:id
 * @desc    Update schedule
 * @access  Private
 */
export const updateSchedule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { scheduledFor, timezone, recurring, recurrenceRule, notifyOnCompletion, notifyUsers } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const schedule = await Schedule.findOne({ _id: id, tenantId });

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }

    // Only allow updating pending schedules
    if (schedule.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot update schedule with status: ${schedule.status}`
      });
    }

    // Update fields
    if (scheduledFor) schedule.scheduledFor = new Date(scheduledFor);
    if (timezone) schedule.timezone = timezone;
    if (recurring !== undefined) schedule.recurring = recurring;
    if (recurrenceRule !== undefined) schedule.recurrenceRule = recurrenceRule;
    if (notifyOnCompletion !== undefined) schedule.notifyOnCompletion = notifyOnCompletion;
    if (notifyUsers) schedule.notifyUsers = notifyUsers;

    schedule.updatedBy = userId;
    await schedule.save();

    return res.json({
      success: true,
      message: 'Schedule updated successfully',
      data: { schedule }
    });
  } catch (error: any) {
    console.error('Error updating schedule:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update schedule',
      error: error.message
    });
  }
};

/**
 * @route   DELETE /api/v1/schedules/:id
 * @desc    Delete schedule
 * @access  Private
 */
export const deleteSchedule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const schedule = await Schedule.findOne({ _id: id, tenantId });

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }

    await schedule.deleteOne();

    return res.json({
      success: true,
      message: 'Schedule deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting schedule:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete schedule',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/schedules/:id/cancel
 * @desc    Cancel schedule
 * @access  Private
 */
export const cancelSchedule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const schedule = await Schedule.findOne({ _id: id, tenantId });

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }

    if (!(schedule as any).isPending()) {
      return res.status(400).json({
        success: false,
        message: 'Only pending schedules can be cancelled'
      });
    }

    (schedule as any).cancel();
    schedule.updatedBy = userId;
    await schedule.save();

    return res.json({
      success: true,
      message: 'Schedule cancelled successfully',
      data: { schedule }
    });
  } catch (error: any) {
    console.error('Error cancelling schedule:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel schedule',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/schedules/:id/execute
 * @desc    Execute schedule manually
 * @access  Private
 */
export const executeSchedule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const schedule = await Schedule.findOne({ _id: id, tenantId });

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }

    if (!(schedule as any).isPending()) {
      return res.status(400).json({
        success: false,
        message: 'Only pending schedules can be executed'
      });
    }

    // Get content
    const content = await Content.findById(schedule.contentId);
    if (!content) {
      (schedule as any).markAsFailed('Content not found');
      await schedule.save();
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Mark as processing
    (schedule as any).markAsProcessing();
    await schedule.save();

    try {
      // Execute action
      switch (schedule.action) {
        case 'publish':
          await content.publish();
          break;
        case 'unpublish':
          await content.unpublish();
          break;
        case 'archive':
          content.status = 'archived';
          await content.save();
          break;
      }

      // Mark as completed
      (schedule as any).markAsCompleted();
      await schedule.save();

      return res.json({
        success: true,
        message: 'Schedule executed successfully',
        data: { schedule }
      });
    } catch (execError: any) {
      // Mark as failed
      (schedule as any).markAsFailed(execError.message);
      await schedule.save();

      return res.status(500).json({
        success: false,
        message: 'Failed to execute schedule',
        error: execError.message
      });
    }
  } catch (error: any) {
    console.error('Error executing schedule:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to execute schedule',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/content/:id/schedules
 * @desc    Get schedules for specific content
 * @access  Private
 */
export const getContentSchedules = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const schedules = await (Schedule as any).findByContent(id);

    return res.json({
      success: true,
      data: {
        schedules,
        total: schedules.length
      }
    });
  } catch (error: any) {
    console.error('Error fetching content schedules:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch content schedules',
      error: error.message
    });
  }
};
