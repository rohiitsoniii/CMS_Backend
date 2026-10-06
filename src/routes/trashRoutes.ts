import { Router } from 'express';
import { trashController } from '../controllers/trashController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/projects/:projectId/trash', trashController.moveToTrash);
router.get('/projects/:projectId/trash', trashController.getTrashItems);
router.post('/trash/:trashId/restore', trashController.restore);
router.delete('/trash/:trashId', trashController.permanentDelete);
router.post('/trash/bulk-restore', trashController.bulkRestore);
router.delete('/projects/:projectId/trash', trashController.emptyTrash);

export default router;
