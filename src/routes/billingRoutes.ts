import { Router } from 'express';
import { billingController } from '../controllers/billingController';
import { authenticate } from '../middleware/auth';
import express from 'express';

const router = Router();

// Public routes
router.get('/plans', billingController.getPlans);

// Webhook (no auth required, verified by Stripe signature)
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  billingController.handleWebhook
);

// Protected routes
router.use(authenticate);

router.get('/subscription', billingController.getSubscription);
router.post('/subscription', billingController.createSubscription);
router.put('/subscription', billingController.updateSubscription);
router.post('/subscription/cancel', billingController.cancelSubscription);
router.post('/subscription/reactivate', billingController.reactivateSubscription);

router.get('/invoices', billingController.getInvoices);
router.get('/usage', billingController.getUsage);

router.post('/setup-intent', billingController.createSetupIntent);
router.post('/payment-method', billingController.updatePaymentMethod);
router.post('/portal', billingController.createPortalSession);
router.post('/validate-coupon', billingController.validateCoupon);


export default router;
