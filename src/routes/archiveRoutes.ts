import { Router } from 'express';
import { archiveController } from '../controllers/archiveController';
import { authenticate } from '../middleware/auth';

const router = Router();

// NOTE: mounted once at / in routes/index.ts alongside public routes,
// so auth must be per-route (a router-level router.use(authenticate)
// would 401 every public request, e.g. /deliver/* and /media/:id).

// Canonical archive routes (matches frontend archiveAPI)
router.get('/projects/:projectId/archive', authenticate, archiveController.getArchived);
router.get('/projects/:projectId/archive/stats', authenticate, archiveController.getStats);
router.post('/projects/:projectId/archive/bulk', authenticate, archiveController.bulkArchive);
router.post('/archive/:contentId', authenticate, archiveController.archive);
router.post('/archive/:archiveId/restore', authenticate, archiveController.restore);
router.delete('/archive/:archiveId', authenticate, archiveController.permanentDelete);
// Legacy alias
router.post('/content/:contentId/archive', authenticate, archiveController.archive);

export default router;
