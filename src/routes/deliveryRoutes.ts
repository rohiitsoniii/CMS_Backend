import { Router } from 'express';
import {
  getAllContent,
  getDefaultContent,
  getBlogs,
  getBlogBySlug,
  getPageBySlug,
  getFAQs,
  getTestimonials,
  getChatbotConfig,
} from '../controllers/deliveryController.js';
import {
  chatWithBot,
  getChatSuggestions,
  rateChatResponse,
} from '../controllers/chatbotController.js';
import { ContentTypes } from '../models/index.js';
import { authenticateAPIKey, apiKeyRateLimiter } from '../middleware/index.js';
import { validate, body } from '../middleware/validate.js';
import { cacheResponse } from '../middleware/cache.js';
import { deliveryRateLimit, deliveryHeavyRateLimit } from '../middleware/deliveryRateLimit.js';
import { buildSitemapXml } from '../services/geoService.js';
import { Project } from '../models/index.js';

const router = Router();

// Optional API key auth for public routes
router.use(authenticateAPIKey);

// Global API-key rate limiting
router.use(apiKeyRateLimiter);

// Per-project isolation rate limiting (protects tenants from each other)
router.use(deliveryRateLimit);

// Validate :projectSlug on every delivery route (slug pattern only —
// prevents operator/RegExp payloads reaching Mongoose queries)
router.param('projectSlug', (_req, res, next, value) => {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,200}$/.test(value)) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: [{ field: 'projectSlug', message: 'Invalid project slug' }],
    });
    return;
  }
  next();
});

// Validate content :slug params the same way
router.param('slug', (_req, res, next, value) => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: [{ field: 'slug', message: 'Invalid slug' }],
    });
    return;
  }
  next();
});

// ============================
// Full Site Content
// ============================

// Get all default content — stricter rate limit + cache
router.get('/:projectSlug/all', deliveryHeavyRateLimit, cacheResponse(300), getAllContent);

// ============================
// Section-Specific Endpoints
// ============================

// Header
router.get('/:projectSlug/header', cacheResponse(300), getDefaultContent(ContentTypes.HEADER));

// Footer
router.get('/:projectSlug/footer', cacheResponse(300), getDefaultContent(ContentTypes.FOOTER));

// Hero
router.get('/:projectSlug/hero', cacheResponse(300), getDefaultContent(ContentTypes.HERO));
router.get('/:projectSlug/hero/:page', cacheResponse(300), getDefaultContent(ContentTypes.HERO));

// Navigation
router.get('/:projectSlug/navigation', cacheResponse(300), getDefaultContent(ContentTypes.NAVIGATION));

// ============================
// Blogs
// ============================

// List blogs
router.get('/:projectSlug/blogs', cacheResponse(300), getBlogs);

// Single blog
router.get('/:projectSlug/blogs/:slug', cacheResponse(300), getBlogBySlug);

// ============================
// Pages
// ============================

// Single page
router.get('/:projectSlug/pages/:slug', cacheResponse(300), getPageBySlug);

// ============================
// Other Sections
// ============================

// FAQs
router.get('/:projectSlug/faqs', cacheResponse(300), getFAQs);

// Testimonials
router.get('/:projectSlug/testimonials', cacheResponse(300), getTestimonials);

// Banners/Popups
router.get('/:projectSlug/banners', cacheResponse(300), getDefaultContent(ContentTypes.BANNER));

// Pricing
router.get('/:projectSlug/pricing', cacheResponse(300), getDefaultContent(ContentTypes.PRICING));

// Features
router.get('/:projectSlug/features', cacheResponse(300), getDefaultContent(ContentTypes.FEATURE));

// Team
router.get('/:projectSlug/team', cacheResponse(300), getDefaultContent(ContentTypes.TEAM));

// Gallery
router.get('/:projectSlug/gallery', cacheResponse(300), getDefaultContent(ContentTypes.GALLERY));

// CTA
router.get('/:projectSlug/cta', cacheResponse(300), getDefaultContent(ContentTypes.CTA));

// ============================
// Chatbot (FREE - No paid APIs!)
// ============================

// Get chatbot config (for embed widget)
router.get('/:projectSlug/chatbot/config', getChatbotConfig);

// Get suggested questions
router.get('/:projectSlug/chat/suggestions', getChatSuggestions);

// Chat with bot (keyword matching + optional local Ollama)
router.post(
  '/:projectSlug/chat',
  [
    body('message').isString().trim().notEmpty().isLength({ max: 4000 }),
    body('sessionId').optional().isString().isLength({ max: 200 }),
  ],
  validate,
  chatWithBot
);

// Rate response
router.post(
  '/:projectSlug/chat/rate',
  [
    body('knowledgeId').isMongoId().withMessage('Invalid knowledgeId'),
    body('helpful').isBoolean(),
  ],
  validate,
  rateChatResponse
);

// ============================
// Sitemap (Auto-updated on publish)
// ============================
router.get('/:projectSlug/sitemap.xml', async (req, res) => {
  try {
    const { projectSlug } = req.params;
    const project = await Project.findOne({ slug: projectSlug, status: 'active' });
    if (!project) return res.status(404).send('Project not found');

    const xml = await buildSitemapXml(project._id.toString());
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=1800');
    return res.send(xml);
  } catch (err: any) {
    return res.status(500).send(`<?xml version="1.0"?><error>${err.message}</error>`);
  }
});

export default router;
