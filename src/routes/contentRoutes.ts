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
import { authenticateJWT, requirePermission } from '../middleware/index.js';

const router = Router({ mergeParams: true });

// All routes require authentication
router.use(authenticateJWT);

// ============================
// Generic Content Routes
// ============================

// List all content for project
router.get('/', getContentList);

// Create content
router.post('/', requirePermission('content:write'), createContent);

// Reorder content
router.put('/reorder', requirePermission('content:write'), reorderContent);

// Bulk operations
router.post('/bulk', requirePermission('content:write'), bulkOperations);

// Trash management
router.get('/trash', getTrash);
router.delete('/trash/empty', requirePermission('content:delete'), emptyTrash);

// Get single content
router.get('/:id', getContent);

// Update content
router.put('/:id', requirePermission('content:write'), updateContent);

// Delete content
router.delete('/:id', requirePermission('content:delete'), deleteContent);

// Set as default
router.post('/:id/default', requirePermission('content:write'), setContentAsDefault);

// Publish content
router.post('/:id/publish', requirePermission('content:write'), publishContent);

// Unpublish content
router.post('/:id/unpublish', requirePermission('content:write'), unpublishContent);

// Version history
router.get('/:id/versions', getVersionHistory);

// Restore version
router.post('/:id/versions/:version/restore', requirePermission('content:write'), restoreVersion);

// Duplicate content
router.post('/:id/duplicate', requirePermission('content:write'), duplicateContent);

// Restore from trash
router.post('/:id/restore', requirePermission('content:write'), restoreContent);

// Permanent delete
router.delete('/:id/permanent', requirePermission('content:delete'), permanentDeleteContent);

// ============================
// Type-Specific Shorthand Routes
// ============================

// Create type-specific routers
const createTypeRouter = (type: string) => {
  const typeRouter = Router({ mergeParams: true });
  
  typeRouter.get('/', getContentByType(type as keyof typeof ContentTypes));
  
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
