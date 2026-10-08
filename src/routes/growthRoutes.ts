import { Router } from 'express';
import { authenticateJWT, requirePermission } from '../middleware/index.js';
import * as g from '../controllers/growthController.js';
import * as inbox from '../controllers/inboxController.js';

/**
 * Growth features — mounted at /api/v1/projects/:projectId
 *   /automations, /forms, /form-submissions, /contacts/:id/profile
 */
const router = Router({ mergeParams: true });

// Auth per route (not router.use) so unrelated /projects/:projectId/* routes
// mounted after this router are not intercepted.
const read = [authenticateJWT, requirePermission('content:read')];
const write = [authenticateJWT, requirePermission('content:update')];
const publish = [authenticateJWT, requirePermission('content:publish')];

router.get('/automations', read, g.listAutomations);
router.post('/automations', write, g.createAutomation);
router.get('/automations/:id', read, g.getAutomation);
router.put('/automations/:id', publish, g.updateAutomation);
router.delete('/automations/:id', write, g.deleteAutomation);

router.get('/forms', read, g.listForms);
router.post('/forms', write, g.createForm);
router.get('/forms/:id', read, g.getForm);
router.put('/forms/:id', write, g.updateForm);
router.delete('/forms/:id', write, g.deleteForm);
router.get('/forms/:id/export', read, g.exportSubmissions);

router.get('/form-submissions', read, g.listSubmissions);
router.put('/form-submissions/:id', write, g.updateSubmission);
router.delete('/form-submissions/:id', write, g.deleteSubmission);

router.get('/contacts/:id/profile', read, g.contactProfile);

// Live chat inbox (human takeover)
router.get('/inbox', read, inbox.listConversations);
router.get('/inbox/:id', read, inbox.getConversation);
router.post('/inbox/:id/reply', write, inbox.reply);
router.post('/inbox/:id/status', write, inbox.setStatus);

export default router;
