import express from 'express';
import {
  getWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  startWorkflow,
  advanceWorkflow,
  rejectWorkflow,
  getWorkflowState
} from '../controllers/workflowController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

/**
 * Workflow Routes
 * All routes require authentication
 */

// Workflow CRUD
router.get('/', authenticateJWT, getWorkflows);
router.get('/:apiId', authenticateJWT, getWorkflow);
router.post('/', authenticateJWT, createWorkflow);
router.put('/:apiId', authenticateJWT, updateWorkflow);
router.delete('/:apiId', authenticateJWT, deleteWorkflow);

export default router;

// Content workflow routes (to be mounted under /api/v1/content/:id/workflow)
export const contentWorkflowRouter = express.Router({ mergeParams: true });

contentWorkflowRouter.get('/', authenticateJWT, getWorkflowState);
contentWorkflowRouter.post('/start', authenticateJWT, startWorkflow);
contentWorkflowRouter.post('/advance', authenticateJWT, advanceWorkflow);
contentWorkflowRouter.post('/reject', authenticateJWT, rejectWorkflow);
