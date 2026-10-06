import express from 'express';
import {
  getComponents,
  getComponent,
  createComponent,
  updateComponent,
  deleteComponent,
  addField,
  updateField,
  deleteField,
  reorderFields,
  getComponentUsage
} from '../controllers/componentController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

/**
 * Component Routes
 * All routes require authentication
 */

// Component CRUD
router.get('/', authenticateJWT, getComponents);
router.get('/:apiId', authenticateJWT, getComponent);
router.post('/', authenticateJWT, createComponent);
router.put('/:apiId', authenticateJWT, updateComponent);
router.delete('/:apiId', authenticateJWT, deleteComponent);

// Field Management
router.post('/:apiId/fields', authenticateJWT, addField);
router.put('/:apiId/fields/:fieldId', authenticateJWT, updateField);
router.delete('/:apiId/fields/:fieldId', authenticateJWT, deleteField);
router.put('/:apiId/fields/reorder', authenticateJWT, reorderFields);

// Usage Information
router.get('/:id/usage', authenticateJWT, getComponentUsage);

export default router;
