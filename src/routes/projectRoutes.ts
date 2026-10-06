import { Router } from 'express';
import {
  createProject,
  getProjects,
  getProject,
  updateProject,
  deleteProject,
  duplicateProject,
  getProjectStats,
  generatePreviewToken,
} from '../controllers/projectController.js';
import { authenticateJWT, requirePermission } from '../middleware/index.js';
import { checkProjectQuota } from '../middleware/quotaMiddleware.js';

const router = Router();

// All routes require authentication
router.use(authenticateJWT);

// List projects
router.get('/', getProjects);

// Create project - check quota first
router.post('/', checkProjectQuota, requirePermission('content:write'), createProject);

// Get single project
router.get('/:id', getProject);

// Update project
router.put('/:id', requirePermission('content:write'), updateProject);

// Delete project
router.delete('/:id', requirePermission('content:delete'), deleteProject);

// Duplicate project
router.post('/:id/duplicate', requirePermission('content:write'), duplicateProject);

// Get project statistics
router.get('/:id/stats', getProjectStats);

// Get preview token
router.get('/:id/preview-token', requirePermission('content:read'), generatePreviewToken);

export default router;
