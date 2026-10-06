import { Router } from 'express';
import { emailCampaignController } from '../controllers/emailCampaignController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all campaigns
router.get('/', emailCampaignController.getCampaigns.bind(emailCampaignController));

// Get single campaign
router.get('/:id', emailCampaignController.getCampaign.bind(emailCampaignController));

// Create campaign
router.post('/', emailCampaignController.createCampaign.bind(emailCampaignController));

// Update campaign
router.put('/:id', emailCampaignController.updateCampaign.bind(emailCampaignController));

// Delete campaign
router.delete('/:id', emailCampaignController.deleteCampaign.bind(emailCampaignController));

// Send campaign
router.post('/:id/send', emailCampaignController.sendCampaign.bind(emailCampaignController));

// Schedule campaign
router.post('/:id/schedule', emailCampaignController.scheduleCampaign.bind(emailCampaignController));

// Pause campaign
router.post('/:id/pause', emailCampaignController.pauseCampaign.bind(emailCampaignController));

// Resume campaign
router.post('/:id/resume', emailCampaignController.resumeCampaign.bind(emailCampaignController));

// Get campaign statistics
router.get('/:id/stats', emailCampaignController.getCampaignStats.bind(emailCampaignController));

// Get campaign recipients
router.get('/:id/recipients', emailCampaignController.getCampaignRecipients.bind(emailCampaignController));

export default router;
