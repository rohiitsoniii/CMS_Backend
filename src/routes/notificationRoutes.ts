import express from 'express';
import { notificationController } from '../controllers/notificationController.js';
import { authenticateJWT } from '../middleware/index.js';

const router = express.Router();

// Require Auth
router.use(authenticateJWT);

router.get('/', notificationController.getNotifications);
router.patch('/read-all', notificationController.markAllAsRead);
router.delete('/', notificationController.clearAll);
router.patch('/:id/read', notificationController.markAsRead);

export default router;
