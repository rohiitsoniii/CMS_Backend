import { Router } from 'express';
import { trashController } from '../controllers/trashController';
import { authenticate } from '../middleware/auth';

const router = Router();

// NOTE: mounted once at / in routes/index.ts alongside public routes,
// so auth must be per-route (a router-level router.use(authenticate)
// would 401 every public request, e.g. /deliver/* and /media/:id).

// Canonical trash routes
router.post('/projects/:projectId/trash', authenticate, trashController.moveToTrash);
router.get('/projects/:projectId/trash', authenticate, trashController.getTrashItems);
router.delete('/projects/:projectId/trash', authenticate, trashController.emptyTrash);
router.post('/trash/bulk-restore', authenticate, trashController.bulkRestore);
router.post('/trash/:trashId/restore', authenticate, trashController.restore);
router.delete('/trash/:trashId', authenticate, trashController.permanentDelete);

export default router;
