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
import { validate, mongoId, body, param } from '../middleware/validate.js';
import { checkStorageQuota } from '../middleware/quotaMiddleware.js';

const router = Router();

// All routes require authentication
router.use(authenticateJWT);

// Folder management routes
router.get('/folders', getMediaFolders);
router.post(
  '/folders',
  requirePermission('content:write'),
  [body('name').isString().trim().notEmpty().isLength({ max: 100 })],
  validate,
  createFolder
);
router.put(
  '/folders/:name',
  requirePermission('content:write'),
  [
    param('name').isString().trim().notEmpty().isLength({ max: 100 }),
    body('newName').isString().trim().notEmpty().isLength({ max: 100 }),
  ],
  validate,
  renameFolder
);
router.delete(
  '/folders/:name',
  requirePermission('content:delete'),
  [param('name').isString().trim().notEmpty().isLength({ max: 100 })],
  validate,
  deleteFolder
);

// Bulk operations
router.post(
  '/bulk-delete',
  requirePermission('content:delete'),
  [body('fileIds').isArray({ min: 1 }).withMessage('fileIds must be a non-empty array')],
  validate,
  bulkDeleteFiles
);
router.post(
  '/bulk-move',
  requirePermission('content:write'),
  [
    body('fileIds').isArray({ min: 1 }).withMessage('fileIds must be a non-empty array'),
    body('targetFolder').isString().trim().notEmpty().isLength({ max: 100 }),
  ],
  validate,
  bulkMoveFiles
);

// Upload file - check storage quota first (body validated after multer parses multipart)
router.post(
  '/upload',
  checkStorageQuota,
  requirePermission('content:write'),
  upload.single('file'),
  [body('folder').optional().isString().trim().isLength({ max: 100 })],
  validate,
  uploadFile
);

// List files
router.get('/', getMediaFiles);

// Get single file
router.get('/:id', mongoId('id'), validate, getMediaFile);

// Update file metadata
router.put(
  '/:id',
  requirePermission('content:write'),
  [
    mongoId('id'),
    body('alt').optional().isString().isLength({ max: 500 }),
    body('caption').optional().isString().isLength({ max: 1000 }),
    body('folder').optional().isString().isLength({ max: 100 }),
  ],
  validate,
  updateMediaFile
);

// Delete file
router.delete('/:id', requirePermission('content:delete'), mongoId('id'), validate, deleteMediaFile);

export default router;
