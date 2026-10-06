/**
 * Scheduling Routes
 * 
 * Routes for content scheduling
 */

import express from 'express';
import * as schedulingController from '../controllers/schedulingController';
import { authenticate } from '../middleware/auth';

const router = express.Router({ mergeParams: true });

// All scheduling routes require authentication
router.use(authenticate);

// Individual content scheduling
router.post('/:id/schedule/publish', schedulingController.schedulePublish);
router.post('/:id/schedule/unpublish', schedulingController.scheduleUnpublish);
router.put('/:id/schedule', schedulingController.updateScheduling);
router.delete('/:id/schedule', schedulingController.clearScheduling);
router.get('/:id/schedule', schedulingController.getContentSchedule);

// Bulk scheduling
router.post('/schedule/bulk-publish', schedulingController.bulkSchedulePublish);

// Calendar view
router.get('/schedule/calendar', schedulingController.getCalendarView);

// All scheduled tasks
router.get('/schedule/tasks', schedulingController.getScheduledTasks);

export default router;
