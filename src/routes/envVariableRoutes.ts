import { Router } from 'express';
import { EnvVariableController } from '../controllers/envVariableController.js';
import { authenticateJWT, requirePermission } from '../middleware/index.js';

const router = Router();

router.use(authenticateJWT);

router.get('/', EnvVariableController.getVariables);
router.get('/export', EnvVariableController.exportVariables);
router.get('/:id', EnvVariableController.getVariable);
router.post('/', requirePermission('settings:write'), EnvVariableController.createVariable);
router.put('/:id', requirePermission('settings:write'), EnvVariableController.updateVariable);
router.delete('/:id', requirePermission('settings:write'), EnvVariableController.deleteVariable);
router.post('/bulk', requirePermission('settings:write'), EnvVariableController.bulkCreate);

export default router;