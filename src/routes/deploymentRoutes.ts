import { Router } from 'express';
import { deploymentController } from '../controllers/deploymentController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/:projectId', deploymentController.getIntegrations);
router.post('/:projectId', deploymentController.createIntegration);
router.post('/trigger/:id', deploymentController.triggerDeploy);
router.delete('/:id', deploymentController.deleteIntegration);

export default router;
