import { Router } from 'express';
import { roleController } from '../controllers/roleController';
import { authenticateJWT as authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all roles
router.get('/', roleController.getRoles.bind(roleController));

// Get default system roles
router.get('/default', roleController.getDefaultRoles.bind(roleController));

// Get single role
router.get('/:id', roleController.getRole.bind(roleController));

// Create custom role
router.post('/', roleController.createRole.bind(roleController));

// Update role
router.put('/:id', roleController.updateRole.bind(roleController));

// Delete role
router.delete('/:id', roleController.deleteRole.bind(roleController));

// Clone role
router.post('/:id/clone', roleController.cloneRole.bind(roleController));

export default router;
