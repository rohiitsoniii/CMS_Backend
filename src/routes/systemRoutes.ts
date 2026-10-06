import { Router } from 'express';
import { systemController } from '../controllers/systemController.js';
import { authenticateJWT, requireSuperAdmin } from '../middleware/index.js';

const router = Router();

// Error logging for frontend errors (open to capture client telemetry)
router.post('/errors/log-frontend', systemController.logFrontendError);

// All system routes require authentication
router.use(authenticateJWT);

// Real-time log streaming (SSE)
router.get('/logs/stream', systemController.streamLogs);

// All other system routes require Super Admin authentication
router.use(requireSuperAdmin);


// Dashboard Stats
router.get('/stats', systemController.getStats);

// Tenant Management
router.get('/tenants', systemController.getTenants);

// Error Monitoring
router.get('/errors', systemController.getErrorLogs);
router.patch('/errors/:id/fix', systemController.markErrorFixed);

// Coupon Management
router.get('/coupons', systemController.getCoupons);
router.post('/coupons', systemController.createCoupon);

export default router;
