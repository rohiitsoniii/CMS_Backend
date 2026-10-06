/**
 * AI Routes
 * 
 * Routes for AI-powered features
 */

import express from 'express';
import * as aiController from '../controllers/aiController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// All AI routes require authentication
router.use(authenticate);

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
