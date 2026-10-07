import { Router } from 'express';
import { SSOController } from '../controllers/ssoController.js';
import { authenticateJWT } from '../middleware/auth.js';
import { authBruteForceLimit } from '../middleware/bruteForce.js';

const router = Router();

router.get('/google/url', SSOController.getGoogleLoginUrl);
router.get('/google/callback', authBruteForceLimit, SSOController.handleGoogleCallback);
router.post('/google/link', authenticateJWT, SSOController.linkGoogleAccount);
router.post('/google/unlink', authenticateJWT, SSOController.unlinkGoogleAccount);
router.get('/status', authenticateJWT, SSOController.getSSOStatus);

export default router;