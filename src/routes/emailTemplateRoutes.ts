import { Router } from 'express';
import { emailTemplateController } from '../controllers/emailTemplateController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all templates
router.get('/', emailTemplateController.getTemplates.bind(emailTemplateController));

// Get single template
router.get('/:id', emailTemplateController.getTemplate.bind(emailTemplateController));

// Create template
router.post('/', emailTemplateController.createTemplate.bind(emailTemplateController));

// Update template
router.put('/:id', emailTemplateController.updateTemplate.bind(emailTemplateController));

// Delete template
router.delete('/:id', emailTemplateController.deleteTemplate.bind(emailTemplateController));

// Preview template
router.post('/:id/preview', emailTemplateController.previewTemplate.bind(emailTemplateController));

// Send test email
router.post('/:id/send-test', emailTemplateController.sendTestEmail.bind(emailTemplateController));

export default router;
