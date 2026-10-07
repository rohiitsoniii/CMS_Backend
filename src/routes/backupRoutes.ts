import { Router } from 'express';
import {
  createBackup,
  listBackups,
  downloadBackup,
  restoreBackup,
  deleteBackup,
  cleanupBackups,
} from '../controllers/backupController.js';
import { authenticateJWT, requirePermission } from '../middleware/index.js';

const router = Router();

// NOTE: mounted once at / in routes/index.ts alongside public routes,
// so auth must be per-route (a router-level router.use(authenticateJWT)
// would 401 every public request, e.g. /deliver/* and /media/:id).

// Create backup (global or project-scoped)
router.post('/backups', authenticateJWT, requirePermission('admin'), createBackup);
router.post('/projects/:projectId/backups', authenticateJWT, requirePermission('admin'), createBackup);

// List backups (global or project-scoped)
router.get('/backups', authenticateJWT, requirePermission('admin'), listBackups);
router.get('/projects/:projectId/backups', authenticateJWT, requirePermission('admin'), listBackups);

// Download backup
router.get('/backups/:filename/download', authenticateJWT, requirePermission('admin'), downloadBackup);

// Restore backup
router.post('/backups/:filename/restore', authenticateJWT, requirePermission('admin'), restoreBackup);

// Delete backup
router.delete('/backups/:filename', authenticateJWT, requirePermission('admin'), deleteBackup);

// Cleanup old backups
router.post('/backups/cleanup', authenticateJWT, requirePermission('admin'), cleanupBackups);

export default router;
