import { Router } from 'express';
import { SSOController } from '../controllers/ssoController.js';
import { SSOService } from '../services/ssoService.js';
import { authenticateJWT } from '../middleware/auth.js';
import { authBruteForceLimit } from '../middleware/bruteForce.js';

const router = Router();

// Public: which sign-in buttons the login page should show
router.get('/providers', (_req, res) => { res.json({ success: true, data: SSOService.status() }); });

// Status (which providers are configured + the user's linked provider)
router.get('/status', authenticateJWT, SSOController.getSSOStatus);

// Legacy Google endpoints (kept for existing clients)
router.post('/google/link', authenticateJWT, SSOController.legacyLink);
router.post('/google/unlink', authenticateJWT, SSOController.unlink);

// Google, Microsoft, GitHub
router.get('/:provider/url', SSOController.getLoginUrl);
router.get('/:provider/link-url', authenticateJWT, SSOController.getLinkUrl);
router.get('/:provider/callback', authBruteForceLimit, SSOController.handleCallback);
router.post('/unlink', authenticateJWT, SSOController.unlink);

export default router;
