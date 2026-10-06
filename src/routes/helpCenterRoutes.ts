import { Router } from 'express';
import { HelpCenterController } from '../controllers/helpCenterController.js';
import { authenticate, requirePermission } from '../middleware/index.js';

const router = Router();

router.get('/categories', HelpCenterController.getCategories);
router.get('/categories/:slug', HelpCenterController.getCategory);
router.get('/articles/search', HelpCenterController.search);
router.get('/articles/popular', HelpCenterController.getPopular);
router.get('/articles/:slug', HelpCenterController.getArticle);
router.post('/articles/:slug/helpful', HelpCenterController.markHelpful);

router.use(authenticate);
router.post('/articles', requirePermission('settings:write'), HelpCenterController.createArticle);
router.put('/articles/:slug', requirePermission('settings:write'), HelpCenterController.updateArticle);
router.delete('/articles/:slug', requirePermission('settings:write'), HelpCenterController.deleteArticle);
router.post('/categories', requirePermission('settings:write'), HelpCenterController.createCategory);

export default router;