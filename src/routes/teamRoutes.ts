import { Router } from 'express';
import { teamMemberController } from '../controllers/teamMemberController';
import { authenticateJWT as authenticate } from '../middleware/auth';
import { checkTeamMemberQuota } from '../middleware/quotaMiddleware.js';

const router = Router();

// Public route - Accept invitation
router.post('/accept-invite', teamMemberController.acceptInvitation.bind(teamMemberController));

// All other routes require authentication
router.use(authenticate);

// Get all team members
router.get('/', teamMemberController.getTeamMembers.bind(teamMemberController));

// Get single team member
router.get('/:id', teamMemberController.getTeamMember.bind(teamMemberController));

// Invite team member - check quota first
router.post('/invite', checkTeamMemberQuota, teamMemberController.inviteTeamMember.bind(teamMemberController));

// Update team member
router.put('/:id', teamMemberController.updateTeamMember.bind(teamMemberController));

// Change team member role
router.put('/:id/role', teamMemberController.changeRole.bind(teamMemberController));

// Suspend team member
router.put('/:id/suspend', teamMemberController.suspendTeamMember.bind(teamMemberController));

// Reactivate team member
router.put('/:id/reactivate', teamMemberController.reactivateTeamMember.bind(teamMemberController));

// Remove team member
router.delete('/:id', teamMemberController.removeTeamMember.bind(teamMemberController));

// Resend invitation
router.post('/:id/resend', teamMemberController.resendInvitation.bind(teamMemberController));

export default router;
