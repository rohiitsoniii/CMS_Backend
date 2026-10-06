/**
 * References Routes
 * 
 * Routes for content references and backlinks
 */

import express from 'express';
import * as referencesController from '../controllers/referencesController';
import { authenticate } from '../middleware/auth';

const router = express.Router({ mergeParams: true });

// All reference routes require authentication
router.use(authenticate);

// References
router.get('/:id/references', referencesController.getReferences);
router.get('/:id/backlinks', referencesController.getBacklinks);
router.get('/:id/can-delete', referencesController.checkCanDelete);
router.get('/:id/reference-graph', referencesController.getReferenceGraph);

// Validation
router.get('/:id/validate-references', referencesController.validateReferences);
router.post('/:id/fix-references', referencesController.fixBrokenReferences);

// Usage stats
router.get('/:id/usage', referencesController.getUsageStats);

export default router;
