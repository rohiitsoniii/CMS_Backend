import { Router } from 'express';
import { supportTicketController } from '../controllers/supportTicketController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Public endpoint - create ticket
router.post('/tickets', supportTicketController.createTicket.bind(supportTicketController));

// All other routes require authentication
router.use(authenticate);

// Get all tickets
router.get('/tickets', supportTicketController.getTickets.bind(supportTicketController));

// Get single ticket
router.get('/tickets/:id', supportTicketController.getTicket.bind(supportTicketController));

// Update ticket
router.put('/tickets/:id', supportTicketController.updateTicket.bind(supportTicketController));

// Delete ticket
router.delete('/tickets/:id', supportTicketController.deleteTicket.bind(supportTicketController));

// Add reply to ticket
router.post('/tickets/:id/reply', supportTicketController.addReply.bind(supportTicketController));

// Assign ticket to staff
router.put('/tickets/:id/assign', supportTicketController.assignTicket.bind(supportTicketController));

// Update ticket status
router.put('/tickets/:id/status', supportTicketController.updateStatus.bind(supportTicketController));

export default router;
