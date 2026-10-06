import { Router } from 'express';
import { commentsController } from '../controllers/commentsController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/projects/:projectId/content/:contentId/comments', commentsController.create);
router.get('/content/:contentId/comments', commentsController.getComments);
router.get('/content/:contentId/comments/threads', commentsController.getThreads);
router.put('/comments/:commentId', commentsController.update);
router.delete('/comments/:commentId', commentsController.delete);
router.post('/comments/:commentId/resolve', commentsController.resolve);
router.post('/comments/:commentId/unresolve', commentsController.unresolve);
router.get('/content/:contentId/comments/field/:fieldPath', commentsController.getByField);
router.get('/content/:contentId/comments/unresolved-count', commentsController.getUnresolvedCount);

export default router;
