import { Router } from 'express';
import { TwoFactorController } from '../controllers/twoFactorController.js';
import { authenticateJWT, authenticateAllowUnverifiedMfa } from '../middleware/auth.js';
import { authBruteForceLimit } from '../middleware/bruteForce.js';

const router = Router();

// Verify accepts the temporary pre-MFA token (mfaVerified=false); it must
// NOT go through the MFA-enforcing authenticateJWT or it would 403.
// Brute-forced TOTP guessing is rate-limited like login.
router.post('/verify', authBruteForceLimit, authenticateAllowUnverifiedMfa, TwoFactorController.verifyTwoFactor);

router.post('/setup', authenticateJWT, TwoFactorController.setupTwoFactor);
router.post('/enable', authenticateJWT, TwoFactorController.enableTwoFactor);
router.post('/disable', authenticateJWT, TwoFactorController.disableTwoFactor);
router.get('/status', authenticateJWT, TwoFactorController.getStatus);
router.post('/backup-codes/regenerate', authenticateJWT, TwoFactorController.regenerateBackupCodes);

export default router;