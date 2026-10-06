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

router.use(authenticateJWT);

// Create backup
router.post('/', requirePermission('admin'), createBackup);

// List backups
router.get('/', requirePermission('admin'), listBackups);

// Download backup
router.get('/:filename/download', requirePermission('admin'), downloadBackup);

// Restore backup
router.post('/:filename/restore', requirePermission('admin'), restoreBackup);

// Delete backup
router.delete('/:filename', requirePermission('admin'), deleteBackup);

// Cleanup old backups
router.post('/cleanup', requirePermission('admin'), cleanupBackups);

export default router;
