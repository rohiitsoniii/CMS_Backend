import { Router } from 'express';
import { supportController } from '../controllers/supportController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/tickets', supportController.createTicket);
router.get('/tickets', supportController.getTickets);
router.get('/tickets/:id', supportController.getTicket);
router.post('/tickets/:id/messages', supportController.addMessage);
router.patch('/tickets/:id', supportController.updateTicket);
router.post('/tickets/:id/close', supportController.closeTicket);

export default router;
