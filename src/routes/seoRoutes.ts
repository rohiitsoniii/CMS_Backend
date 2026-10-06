import { Router } from 'express';
import { seoController } from '../controllers/seoController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

// All SEO routes are project-scoped and protected
router.use('/:projectId/seo', protect);

router.get('/:projectId/seo/overview', seoController.getProjectOverview);
router.get('/:projectId/seo/report/:contentId', seoController.getReport);
router.post('/:projectId/seo/analyze/:contentId', seoController.analyzeContent);

// Phase 2: Technical SEO
router.get('/:projectId/seo/sitemap', seoController.getSitemap);
router.get('/:projectId/seo/robots', seoController.getRobots);
router.post('/:projectId/seo/robots', seoController.updateRobots);

// Phase 3: Site Audit
router.post('/:projectId/seo/audit/start', seoController.startAudit);
router.get('/:projectId/seo/audit/history', seoController.getAuditHistory);
router.get('/:projectId/seo/audit/:auditId', seoController.getAuditReport);

// Phase 4: AI Intelligence
router.post('/:projectId/seo/ai/generate/:contentId', seoController.generateAiSeo);

// Phase 5: Keyword Tracker
router.get('/:projectId/seo/keywords', seoController.getKeywords);
router.post('/:projectId/seo/keywords/add', seoController.addKeyword);
router.get('/:projectId/seo/keywords/suggest', seoController.suggestKeywords);
router.get('/:projectId/seo/backlinks/suggest', seoController.suggestBacklinks);
router.delete('/:projectId/seo/keywords/:keywordId', seoController.deleteKeyword);

export default router;
