import { Router } from 'express';
import { validationController } from '../controllers/validationController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/content-types/:contentTypeId/validate', validationController.validateContent);
router.post('/validation-rules', validationController.createRule);
router.get('/content-types/:contentTypeId/validation-rules', validationController.getRules);
router.put('/validation-rules/:ruleId', validationController.updateRule);
router.delete('/validation-rules/:ruleId', validationController.deleteRule);

export default router;
