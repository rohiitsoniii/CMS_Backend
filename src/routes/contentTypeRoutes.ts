import express from 'express';
import {
  getContentTypes,
  getContentType,
  createContentType,
  updateContentType,
  deleteContentType,
  addField,
  updateField,
  deleteField,
  reorderFields
} from '../controllers/contentTypeController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

/**
 * Content Type Routes
 * All routes require authentication
 */

// Content Type CRUD
router.get('/', authenticateJWT, getContentTypes);
router.get('/:apiId', authenticateJWT, getContentType);
router.post('/', authenticateJWT, createContentType);
router.put('/:apiId', authenticateJWT, updateContentType);
router.delete('/:apiId', authenticateJWT, deleteContentType);

// Field Management
router.post('/:apiId/fields', authenticateJWT, addField);
router.put('/:apiId/fields/:fieldId', authenticateJWT, updateField);
router.delete('/:apiId/fields/:fieldId', authenticateJWT, deleteField);
router.put('/:apiId/fields/reorder', authenticateJWT, reorderFields);

export default router;
