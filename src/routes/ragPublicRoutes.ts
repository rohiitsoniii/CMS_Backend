import express from 'express';
import * as ragChatController from '../controllers/ragChatController.js';

const router = express.Router();

/**
 * Public RAG Bot Routes
 * Mounted at /api/v1/bots (no auth required)
 */

router.get('/:botSlug/config', ragChatController.getWidgetConfig);
router.post('/:botSlug/chat', ragChatController.ragChat);
router.post('/:botSlug/rate', ragChatController.submitFeedback);
router.post('/:botSlug/lead', ragChatController.captureLead);
router.post('/:botSlug/handoff', ragChatController.requestHandoff);
router.get('/:botSlug/messages', ragChatController.pollMessages);

export default router;
