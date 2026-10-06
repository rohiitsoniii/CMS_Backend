import express from 'express';
import {
  getVersionHistory,
  getVersion,
  compareVersions,
  restoreVersion,
  getCurrentDiff,
  deleteVersion
} from '../controllers/versionController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router({ mergeParams: true });

/**
 * Version History Routes
 * All routes require authentication
 * Routes are mounted under /api/v1/content/:id/versions
 */

// Get version history
router.get('/', authenticateJWT, getVersionHistory);

// Get current diff (compare with previous version)
router.get('/current/diff', authenticateJWT, getCurrentDiff);

// Compare two versions
router.get('/compare', authenticateJWT, compareVersions);

// Get specific version
router.get('/:version', authenticateJWT, getVersion);

// Restore to specific version
router.post('/:version/restore', authenticateJWT, restoreVersion);

// Delete specific version
router.delete('/:version', authenticateJWT, deleteVersion);

export default router;
