import { Router } from 'express';
import {
  createContent,
  getContentList,
  getContentByType,
  getContent,
  updateContent,
  setContentAsDefault,
  publishContent,
  unpublishContent,
  deleteContent,
  getVersionHistory,
  restoreVersion,
  reorderContent,
  duplicateContent,
  getTrash,
  restoreContent,
  permanentDeleteContent,
  emptyTrash,
  bulkOperations,
} from '../controllers/contentController.js';
import { ContentTypes } from '../models/index.js';
import type { ContentType } from '../models/Content.js';
import { authenticateJWT, requirePermission } from '../middleware/index.js';
import { validate, mongoId, paginationQuery, searchQuery, body, param } from '../middleware/validate.js';

const router = Router({ mergeParams: true });

// All routes require authentication
router.use(authenticateJWT);

// ============================
// Generic Content Routes
// ============================

// List all content for project
router.get('/', [...paginationQuery, searchQuery], validate, getContentList);

// Create content
router.post(
  '/',
  requirePermission('content:write'),
  [
    body('type').isString().trim().notEmpty().isLength({ max: 100 }),
    body('name').isString().trim().notEmpty().isLength({ max: 200 }),
  ],
  validate,
  createContent
);

// Reorder content
router.put(
  '/reorder',
  requirePermission('content:write'),
  [body('order').isArray({ min: 1 }).withMessage('order must be a non-empty array')],
  validate,
  reorderContent
);

// Bulk operations
router.post(
  '/bulk',
  requirePermission('content:write'),
  [
    body('operation').isString().trim().notEmpty(),
    body('ids').isArray({ min: 1 }).withMessage('ids must be a non-empty array'),
  ],
  validate,
  bulkOperations
);

// Trash management
router.get('/trash', getTrash);
router.delete('/trash/empty', requirePermission('content:delete'), emptyTrash);

// Get single content
router.get('/:id', mongoId('id'), validate, getContent);

// Update content
router.put('/:id', requirePermission('content:write'), mongoId('id'), validate, updateContent);

// Delete content
router.delete('/:id', requirePermission('content:delete'), mongoId('id'), validate, deleteContent);

// Set as default
router.post('/:id/default', requirePermission('content:write'), mongoId('id'), validate, setContentAsDefault);

// Publish content
router.post('/:id/publish', requirePermission('content:write'), mongoId('id'), validate, publishContent);

// Unpublish content
router.post('/:id/unpublish', requirePermission('content:write'), mongoId('id'), validate, unpublishContent);

// Version history
router.get('/:id/versions', mongoId('id'), validate, getVersionHistory);

// Restore version
router.post(
  '/:id/versions/:version/restore',
  requirePermission('content:write'),
  [mongoId('id'), param('version').isInt({ min: 1 }).withMessage('Invalid version')],
  validate,
  restoreVersion
);

// Duplicate content
router.post('/:id/duplicate', requirePermission('content:write'), mongoId('id'), validate, duplicateContent);

// Restore from trash
router.post('/:id/restore', requirePermission('content:write'), mongoId('id'), validate, restoreContent);

// Permanent delete
router.delete('/:id/permanent', requirePermission('content:delete'), mongoId('id'), validate, permanentDeleteContent);

// ============================
// Type-Specific Shorthand Routes
// ============================

// Create type-specific routers
const createTypeRouter = (type: ContentType) => {
  const typeRouter = Router({ mergeParams: true });
  
  typeRouter.get('/', getContentByType(type));
  
  return typeRouter;
};

// Note: These would be mounted in the main router like:
// /api/v1/projects/:projectId/headers
// /api/v1/projects/:projectId/footers
// etc.

export const headerRoutes = createTypeRouter(ContentTypes.HEADER);
export const footerRoutes = createTypeRouter(ContentTypes.FOOTER);
export const heroRoutes = createTypeRouter(ContentTypes.HERO);
export const blogRoutes = createTypeRouter(ContentTypes.BLOG);
export const pageRoutes = createTypeRouter(ContentTypes.PAGE);
export const faqRoutes = createTypeRouter(ContentTypes.FAQ);
export const testimonialRoutes = createTypeRouter(ContentTypes.TESTIMONIAL);
export const bannerRoutes = createTypeRouter(ContentTypes.BANNER);

export default router;
