import { Router } from 'express';
import { archiveController } from '../controllers/archiveController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/content/:contentId/archive', archiveController.archive);
router.post('/archive/:archiveId/restore', archiveController.restore);
router.get('/projects/:projectId/archive', archiveController.getArchived);
router.post('/projects/:projectId/archive/bulk', archiveController.bulkArchive);
router.delete('/archive/:archiveId', archiveController.permanentDelete);
router.get('/projects/:projectId/archive/stats', archiveController.getStats);

export default router;
