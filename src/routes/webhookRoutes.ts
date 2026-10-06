import express from 'express';
import {
  getWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  getWebhookLogs,
  getWebhookLog,
  retryWebhookLog,
  getWebhookStats
} from '../controllers/webhookController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

router.use(authenticateJWT);

router.get('/', getWebhooks);
router.get('/:id', getWebhook);
router.post('/', createWebhook);
router.put('/:id', updateWebhook);
router.delete('/:id', deleteWebhook);
router.post('/:id/test', testWebhook);

// Webhook Logs
router.get('/logs', getWebhookLogs);
router.get('/logs/stats', getWebhookStats);
router.get('/logs/:id', getWebhookLog);
router.post('/logs/:id/retry', retryWebhookLog);

export default router;
