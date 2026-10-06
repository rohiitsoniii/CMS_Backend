import { Router } from 'express';
import { fieldPermissionsController } from '../controllers/fieldPermissionsController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/field-permissions', fieldPermissionsController.setPermission);
router.get('/content-types/:contentTypeId/roles/:roleId/permissions', fieldPermissionsController.getPermissions);
router.get('/content-types/:contentTypeId/fields/:fieldPath/roles/:roleId/access', fieldPermissionsController.checkAccess);
router.get('/content-types/:contentTypeId/roles/:roleId/accessible-fields', fieldPermissionsController.getAccessibleFields);
router.post('/field-permissions/bulk', fieldPermissionsController.bulkSetPermissions);
router.delete('/field-permissions/:permissionId', fieldPermissionsController.deletePermission);
router.get('/content-types/:contentTypeId/permissions', fieldPermissionsController.getAllPermissions);

export default router;
