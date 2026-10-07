import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as pub from '../controllers/emailPublicController.js';

/**
 * Public email endpoints — mounted at /api/v1/public/email (no auth).
 */
const router = Router();

const subscribeLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many signups from this address, please try again in a minute.' },
});

const trackingLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });

router.post('/:projectId/subscribe', subscribeLimiter, pub.publicSubscribe);
router.get('/confirm/:token', trackingLimiter, pub.confirm);
router.get('/u/:token', trackingLimiter, pub.unsubscribePage);
router.post('/u/:token', trackingLimiter, pub.unsubscribe);
router.get('/o/:token', trackingLimiter, pub.openPixel);
router.get('/c/:token', trackingLimiter, pub.clickRedirect);

export default router;
