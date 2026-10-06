import { Router } from 'express';
import { SSOController } from '../controllers/ssoController.js';

const router = Router();

router.get('/google/url', SSOController.getGoogleLoginUrl);
router.get('/google/callback', SSOController.handleGoogleCallback);
router.post('/google/link', SSOController.linkGoogleAccount);
router.post('/google/unlink', SSOController.unlinkGoogleAccount);
router.get('/status', SSOController.getSSOStatus);

export default router;