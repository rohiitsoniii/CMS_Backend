import { Router } from 'express';
import { PreviewController } from '../controllers/previewController.js';
import { authenticateJWT, requirePermission } from '../middleware/index.js';

const router = Router();

// Protected routes (require auth)
router.post(
  '/content/:contentId/preview',
  authenticateJWT,
  requirePermission('content:read'),
  PreviewController.generateToken
);

router.get(
  '/preview-tokens',
  authenticateJWT,
  requirePermission('content:read'),
  PreviewController.listTokens
);

router.delete(
  '/preview-tokens/:tokenId',
  authenticateJWT,
  requirePermission('content:write'),
  PreviewController.revokeToken
);

export default router;