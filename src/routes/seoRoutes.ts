import { Router } from 'express';
import { seoController } from '../controllers/seoController';
import { protect } from '../middleware/authMiddleware';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requirePermission } from '../middleware/index.js';
import * as suite from '../controllers/seoSuiteController.js';

const router = Router();

// All SEO routes are project-scoped and protected
router.use('/:projectId/seo', protect, requireProjectAccess);

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

// Settings, IndexNow, AI crawler policy, llms.txt
router.get('/:projectId/seo/settings', suite.getSettings);
router.put('/:projectId/seo/settings', requirePermission('settings:update'), suite.updateSettings);
router.post('/:projectId/seo/indexnow/submit', requirePermission('content:publish'), suite.indexNowSubmitAll);

// Redirects & 404 monitor
router.get('/:projectId/seo/redirects', suite.listRedirects);
router.post('/:projectId/seo/redirects', requirePermission('content:update'), suite.createRedirect);
router.post('/:projectId/seo/redirects/import', requirePermission('content:update'), suite.importRedirects);
router.put('/:projectId/seo/redirects/:id', requirePermission('content:update'), suite.updateRedirect);
router.delete('/:projectId/seo/redirects/:id', requirePermission('content:update'), suite.deleteRedirect);
router.get('/:projectId/seo/not-found', suite.listNotFound);
router.post('/:projectId/seo/not-found/:id/dismiss', requirePermission('content:update'), suite.dismissNotFound);

// GEO (AI search readiness) & structured data
router.get('/:projectId/seo/geo', suite.geoOverview);
router.get('/:projectId/seo/geo/:contentId', suite.geoForContent);

// Performance & ranks
router.get('/:projectId/seo/pagespeed', suite.pageSpeed);
router.post('/:projectId/seo/keywords/check', suite.checkRanks);

// Google Search Console
router.get('/:projectId/seo/gsc', suite.gscStatus);
router.get('/:projectId/seo/gsc/connect-url', requirePermission('settings:update'), suite.gscConnectUrl);
router.get('/:projectId/seo/gsc/sites', suite.gscSites);
router.put('/:projectId/seo/gsc/site', requirePermission('settings:update'), suite.gscSelectSite);
router.get('/:projectId/seo/gsc/performance', suite.gscPerformance);
router.delete('/:projectId/seo/gsc', requirePermission('settings:update'), suite.gscDisconnect);

// Content brief + live GEO scoring
router.post('/:projectId/seo/brief', suite.contentBrief);
router.post('/:projectId/seo/geo/analyze', suite.analyzeDraft);

export default router;
