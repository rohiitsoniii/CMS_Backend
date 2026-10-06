import { Router } from 'express';
import { TwoFactorController } from '../controllers/twoFactorController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

router.use(authenticateJWT);

router.post('/setup', TwoFactorController.setupTwoFactor);
router.post('/enable', TwoFactorController.enableTwoFactor);
router.post('/verify', TwoFactorController.verifyTwoFactor);
router.post('/disable', TwoFactorController.disableTwoFactor);
router.get('/status', TwoFactorController.getStatus);
router.post('/backup-codes/regenerate', TwoFactorController.regenerateBackupCodes);

export default router;