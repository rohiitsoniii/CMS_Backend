import express from 'express';
import {
  getSchedules,
  getUpcomingSchedules,
  getScheduleHistory,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  cancelSchedule,
  executeSchedule,
  getContentSchedules
} from '../controllers/scheduleController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

/**
 * Schedule Routes
 * All routes require authentication
 */

// Get upcoming schedules
router.get('/upcoming', authenticateJWT, getUpcomingSchedules);
router.get('/history', authenticateJWT, getScheduleHistory);

// Schedule CRUD
router.get('/', authenticateJWT, getSchedules);
router.get('/:id', authenticateJWT, getSchedule);
router.post('/', authenticateJWT, createSchedule);
router.put('/:id', authenticateJWT, updateSchedule);
router.delete('/:id', authenticateJWT, deleteSchedule);

// Schedule actions
router.post('/:id/cancel', authenticateJWT, cancelSchedule);
router.post('/:id/execute', authenticateJWT, executeSchedule);

export default router;

// Content schedule routes (to be mounted under /api/v1/content/:id/schedules)
export const contentScheduleRouter = express.Router({ mergeParams: true });

contentScheduleRouter.get('/', authenticateJWT, getContentSchedules);
