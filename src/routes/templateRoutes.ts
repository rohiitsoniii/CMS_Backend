import { Router } from 'express';
import { templateController } from '../controllers/templateController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Protected routes
router.use(authenticate);

router.get('/', templateController.getTemplates);
router.post('/apply/:projectId', templateController.applyTemplate);

export default router;
