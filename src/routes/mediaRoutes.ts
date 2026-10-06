import { Router } from 'express';
import {
  upload,
  uploadFile,
  getMediaFiles,
  getMediaFile,
  updateMediaFile,
  deleteMediaFile,
  getMediaFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  bulkDeleteFiles,
  bulkMoveFiles,
} from '../controllers/mediaController.js';
import { authenticateJWT, requirePermission } from '../middleware/index.js';
import { checkStorageQuota } from '../middleware/quotaMiddleware.js';

const router = Router();

// All routes require authentication
router.use(authenticateJWT);

// Folder management routes
router.get('/folders', getMediaFolders);
router.post('/folders', requirePermission('content:write'), createFolder);
router.put('/folders/:name', requirePermission('content:write'), renameFolder);
router.delete('/folders/:name', requirePermission('content:delete'), deleteFolder);

// Bulk operations
router.post('/bulk-delete', requirePermission('content:delete'), bulkDeleteFiles);
router.post('/bulk-move', requirePermission('content:write'), bulkMoveFiles);

// Upload file - check storage quota first
router.post(
  '/upload',
  checkStorageQuota,
  requirePermission('content:write'),
  upload.single('file'),
  uploadFile
);

// List files
router.get('/', getMediaFiles);

// Get single file
router.get('/:id', getMediaFile);

// Update file metadata
router.put('/:id', requirePermission('content:write'), updateMediaFile);

// Delete file
router.delete('/:id', requirePermission('content:delete'), deleteMediaFile);

export default router;
