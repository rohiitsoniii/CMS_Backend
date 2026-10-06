import { Router } from 'express';
import * as publicController from '../controllers/publicController.js';
import { authenticateAPIKey, apiKeyRateLimiter, checkSubscriptionLimits } from '../middleware/index.js';
import { cacheResponse } from '../middleware/cache.js';

const router = Router();

// All public API routes require API key authentication
router.use(authenticateAPIKey);
router.use(apiKeyRateLimiter);
router.use(checkSubscriptionLimits);

// Specific content type endpoints
router.get('/hero-sections', cacheResponse(300), publicController.getHeroSections);
router.get('/navigation', cacheResponse(300), publicController.getNavigation);
router.get('/footer', cacheResponse(300), publicController.getFooter);
router.get('/blogs', cacheResponse(300), publicController.getBlogs);
router.get('/blogs/:slug', cacheResponse(300), publicController.getBlogBySlug);
router.get('/faqs', cacheResponse(300), publicController.getFAQs);
router.get('/testimonials', cacheResponse(300), publicController.getTestimonials);
router.get('/gallery', cacheResponse(300), publicController.getGallery);

// Search
router.get('/search', cacheResponse(60), publicController.searchContent);

// Generic content type endpoints
router.get('/:type', cacheResponse(300), publicController.getContentByType);
router.get('/:type/:slug', cacheResponse(300), publicController.getContentBySlug);

export default router;
