import { Router } from 'express';
import { bulkOperationsController } from '../controllers/bulkOperationsController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/bulk/publish', bulkOperationsController.bulkPublish);
router.post('/bulk/unpublish', bulkOperationsController.bulkUnpublish);
router.post('/projects/:projectId/bulk/delete', bulkOperationsController.bulkDelete);
router.post('/bulk/add-tags', bulkOperationsController.bulkAddTags);
router.post('/bulk/remove-tags', bulkOperationsController.bulkRemoveTags);
router.post('/bulk/update-field', bulkOperationsController.bulkUpdateField);
router.post('/bulk/schedule', bulkOperationsController.bulkSchedule);
router.post('/bulk/move-to-folder', bulkOperationsController.bulkMoveToFolder);

export default router;
