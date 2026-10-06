import { Router } from 'express';
import { body } from 'express-validator';
import * as contentController from '../controllers/contentController.js';
import { authenticateJWT, requirePermission } from '../middleware/index.js';

const router = Router();

// All routes require JWT authentication
router.use(authenticateJWT);

// Validation middleware
const contentValidation = [
  body('type')
    .isIn(['hero_section', 'navigation', 'footer', 'blog_post', 'page', 'cards', 'testimonials', 'faq', 'gallery', 'cta', 'custom'])
    .withMessage('Invalid content type'),
  body('name').trim().notEmpty().withMessage('Content name is required'),
  body('slug').optional().trim(),
  body('data').isObject().withMessage('Data must be an object'),
  body('status').optional().isIn(['draft', 'published', 'scheduled', 'archived']),
  body('tags').optional().isArray(),
];

const updateValidation = [
  body('name').optional().trim().notEmpty(),
  body('slug').optional().trim(),
  body('data').optional().isObject(),
  body('status').optional().isIn(['draft', 'published', 'scheduled', 'archived']),
  body('tags').optional().isArray(),
];

// Content CRUD
router.post(
  '/',
  requirePermission('content:create'),
  contentValidation,
  contentController.createContent
);

router.get(
  '/',
  requirePermission('content:read'),
  contentController.getAllContent
);

router.get(
  '/:id',
  requirePermission('content:read'),
  contentController.getContentById
);

router.put(
  '/:id',
  requirePermission('content:update'),
  updateValidation,
  contentController.updateContent
);

router.delete(
  '/:id',
  requirePermission('content:delete'),
  contentController.deleteContent
);

// Publishing
router.post(
  '/:id/publish',
  requirePermission('content:publish'),
  contentController.publishContent
);

router.post(
  '/:id/unpublish',
  requirePermission('content:publish'),
  contentController.unpublishContent
);

// Versioning
router.get(
  '/:id/versions',
  requirePermission('content:read'),
  contentController.getContentVersions
);

router.post(
  '/:id/versions/:version/restore',
  requirePermission('content:update'),
  contentController.restoreContentVersion
);

export default router;
