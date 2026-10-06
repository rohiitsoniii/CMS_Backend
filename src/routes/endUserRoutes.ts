import { Router } from 'express';
import { endUserController } from '../controllers/endUserController';
import { authenticateJWT as authenticate } from '../middleware/auth';

const router = Router();

// Public routes
router.post('/register', endUserController.register.bind(endUserController));
router.post('/login', endUserController.login.bind(endUserController));
router.post('/forgot-password', endUserController.forgotPassword.bind(endUserController));
router.post('/reset-password', endUserController.resetPassword.bind(endUserController));
router.post('/verify-email', endUserController.verifyEmail.bind(endUserController));

// Authenticated routes
router.use(authenticate);

// User profile routes
router.get('/profile', endUserController.getProfile.bind(endUserController));
router.put('/profile', endUserController.updateProfile.bind(endUserController));

// Admin routes (require admin permission)
router.get('/', endUserController.listUsers.bind(endUserController));
router.get('/:id', endUserController.getUserById.bind(endUserController));
router.put('/:id/suspend', endUserController.suspendUser.bind(endUserController));
router.delete('/:id', endUserController.deleteUser.bind(endUserController));

export default router;
