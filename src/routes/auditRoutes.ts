import { Router } from 'express';
import { getAuditLogs } from '../controllers/auditController.js';
import { authenticateJWT, requireRole } from '../middleware/index.js';

const router = Router();

router.use(authenticateJWT);

// Only admins and owners can view audit logs
router.get('/', requireRole('owner', 'admin'), getAuditLogs);

export default router;
