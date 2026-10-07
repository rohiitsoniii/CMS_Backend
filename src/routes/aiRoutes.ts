/**
 * AI Routes
 * 
 * Routes for AI-powered features
 */

import express from 'express';
import * as aiController from '../controllers/aiController';
import { authenticate, requirePermission } from '../middleware/auth';
import * as aiSettings from '../controllers/aiSettingsController.js';

const router = express.Router();

// All AI routes require authentication
router.use(authenticate);

// Bring your own key + usage (tenant level)
router.get('/settings', aiSettings.getAISettings);
router.put('/settings', requirePermission('settings:update'), aiSettings.saveAISettings);
router.post('/settings/test', requirePermission('settings:update'), aiSettings.testAISettings);
router.delete('/settings', requirePermission('settings:update'), aiSettings.deleteAISettings);
router.get('/usage', aiSettings.getAIUsage);

// Content generation
router.post('/generate/schema', aiController.generateSchema);
router.post('/generate/blog-post', aiController.generateBlogPost);

router.post('/generate/product-description', aiController.generateProductDescription);
router.post('/generate/outline', aiController.generateOutline);
router.post('/generate/email', aiController.generateEmail);

// SEO
router.post('/seo/meta-description', aiController.generateMetaDescription);
router.post('/seo/title', aiController.generateSEOTitle);
router.post('/seo/tags', aiController.generateTags);

// Media
router.post('/media/alt-text', aiController.generateImageAltText);

// Translation
router.post('/translate', aiController.translateContent);

// Content improvement
router.post('/improve', aiController.improveContent);

// Analysis
router.post('/analyze/sentiment', aiController.analyzeSentiment);
router.post('/generate/faq', aiController.generateFAQ);

// Status
router.get('/status', aiController.getAIStatus);

export default router;
