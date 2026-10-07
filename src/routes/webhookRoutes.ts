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
import { validate, mongoId, body, query } from '../middleware/validate.js';

const router = express.Router();

router.use(authenticateJWT);

router.get(
  '/',
  [query('projectId').isMongoId().withMessage('Invalid projectId')],
  validate,
  getWebhooks
);
router.post(
  '/',
  [
    body('projectId').isMongoId().withMessage('Invalid projectId'),
    body('name').isString().trim().notEmpty().isLength({ max: 100 }),
    body('url').isURL({ require_protocol: true, require_tld: false }).withMessage('Valid URL is required'),
    body('events').isArray({ min: 1 }).withMessage('events must be a non-empty array'),
    body('secret').optional().isString().isLength({ max: 500 }),
  ],
  validate,
  createWebhook
);

// Webhook Logs (must precede /:id to avoid Express route shadowing)
router.get(
  '/logs',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
  ],
  validate,
  getWebhookLogs
);
router.get('/logs/stats', getWebhookStats);
router.get('/logs/:id', mongoId('id'), validate, getWebhookLog);
router.post('/logs/:id/retry', mongoId('id'), validate, retryWebhookLog);

// Webhook operations by ID
router.get('/:id', mongoId('id'), validate, getWebhook);
router.put(
  '/:id',
  [
    mongoId('id'),
    body('name').optional().isString().trim().notEmpty().isLength({ max: 100 }),
    body('url').optional().isURL({ require_protocol: true, require_tld: false }),
    body('events').optional().isArray({ min: 1 }),
  ],
  validate,
  updateWebhook
);
router.delete('/:id', mongoId('id'), validate, deleteWebhook);
router.post('/:id/test', mongoId('id'), validate, testWebhook);

export default router;
