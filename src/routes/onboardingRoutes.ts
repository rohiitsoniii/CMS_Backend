import { Router } from 'express';
import { OnboardingController } from '../controllers/onboardingController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.post('/start', OnboardingController.startOnboarding);
router.get('/status', OnboardingController.getOnboardingStatus);
router.post('/complete-step', OnboardingController.completeStep);
router.post('/sample-project', OnboardingController.createSampleProject);
router.get('/quick-start', OnboardingController.getQuickStartGuide);

export default router;