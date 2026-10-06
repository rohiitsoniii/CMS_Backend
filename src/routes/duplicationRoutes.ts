import { Router } from 'express';
import { duplicationController } from '../controllers/duplicationController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/content/:contentId/duplicate', duplicationController.duplicate);
router.post('/content/bulk-duplicate', duplicationController.bulkDuplicate);
router.post('/content/:contentId/template', duplicationController.createTemplate);
router.post('/content/:contentId/clone', duplicationController.cloneToProject);
router.post('/content/:contentId/deep-clone', duplicationController.deepClone);

export default router;
