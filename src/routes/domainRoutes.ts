import { Router } from 'express';
import { DomainController } from '../controllers/domainController.js';
import { authenticateJWT, requirePermission } from '../middleware/index.js';

const router = Router();

router.use(authenticateJWT);

router.get('/', DomainController.getDomains);
router.post('/', requirePermission('settings:write'), DomainController.addDomain);
router.post('/:domainId/verify', requirePermission('settings:write'), DomainController.verifyDomain);
router.post('/:domainId/activate', requirePermission('settings:write'), DomainController.activateDomain);
router.post('/:domainId/primary', requirePermission('settings:write'), DomainController.setPrimaryDomain);
router.delete('/:domainId', requirePermission('settings:write'), DomainController.deleteDomain);

export default router;