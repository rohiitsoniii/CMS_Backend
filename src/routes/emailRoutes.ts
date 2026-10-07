import { Router } from 'express';
import { authenticateJWT, requirePermission } from '../middleware/index.js';
import * as email from '../controllers/emailMarketingController.js';

/**
 * Email marketing (authenticated) — mounted at /api/v1/projects/:projectId/email
 */
const router = Router({ mergeParams: true });

router.use(authenticateJWT);

const read = requirePermission('content:read');
const write = requirePermission('content:update');
const publish = requirePermission('content:publish');
const settings = requirePermission('settings:update');

// Settings (BYO SMTP)
router.get('/settings', read, email.getSettings);
router.put('/settings', settings, email.updateSettings);
router.post('/settings/test', settings, email.testSettings);
router.delete('/settings/smtp', settings, email.removeOwnSmtp);

// Audience
router.get('/subscribers', read, email.listSubscribers);
router.get('/subscribers/stats', read, email.subscriberStats);
router.get('/subscribers/export', read, email.exportSubscribers);
router.post('/subscribers', write, email.createSubscriber);
router.post('/subscribers/import', write, email.importSubscribers);
router.post('/subscribers/bulk', write, email.bulkSubscribers);
router.put('/subscribers/:id', write, email.updateSubscriber);
router.delete('/subscribers/:id', write, email.deleteSubscriber);

// Segments
router.get('/segments', read, email.listSegments);
router.get('/segments/fields', read, email.segmentFields);
router.post('/segments/preview', read, email.previewSegment);
router.post('/segments', write, email.createSegment);
router.put('/segments/:id', write, email.updateSegment);
router.delete('/segments/:id', write, email.deleteSegment);

// Campaigns
router.get('/campaigns', read, email.listCampaigns);
router.post('/campaigns', write, email.createCampaign);
router.post('/campaigns/audience-count', read, email.estimateAudience);
router.get('/campaigns/:id', read, email.getCampaign);
router.put('/campaigns/:id', write, email.updateCampaign);
router.delete('/campaigns/:id', write, email.deleteCampaign);
router.post('/campaigns/:id/duplicate', write, email.duplicateCampaign);
router.post('/campaigns/:id/test', write, email.testCampaign);
router.post('/campaigns/:id/send', publish, email.sendCampaign);
router.post('/campaigns/:id/schedule', publish, email.scheduleCampaign);
router.post('/campaigns/:id/unschedule', publish, email.unscheduleCampaign);
router.post('/campaigns/:id/pause', publish, email.pauseCampaign);
router.post('/campaigns/:id/resume', publish, email.resumeCampaign);
router.post('/campaigns/:id/cancel', publish, email.cancelCampaign);
router.get('/campaigns/:id/stats', read, email.campaignStats);
router.get('/campaigns/:id/recipients', read, email.campaignRecipients);

// Templates
router.get('/templates', read, email.listTemplates);
router.post('/templates', write, email.createTemplate);
router.get('/templates/:id', read, email.getTemplate);
router.put('/templates/:id', write, email.updateTemplate);
router.delete('/templates/:id', write, email.deleteTemplate);
router.post('/templates/:id/test', write, email.testTemplate);

export default router;
