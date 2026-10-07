import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as seo from '../controllers/seoPublicController.js';

/**
 * Public SEO endpoints — mounted at /api/v1/public/seo (no auth).
 */
const router = Router();

router.use(rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false }));

router.get('/:projectId/sitemap.xml', seo.sitemap);
router.get('/:projectId/robots.txt', seo.robots);
router.get('/:projectId/llms.txt', seo.llms);
router.get('/:projectId/llms-full.txt', seo.llmsFull);
router.get('/:projectId/indexnow-key.txt', seo.indexNowKey);
router.get('/:projectId/redirects', seo.redirects);
router.get('/:projectId/resolve', seo.resolvePath);
router.get('/:projectId/meta', seo.meta);

export default router;
