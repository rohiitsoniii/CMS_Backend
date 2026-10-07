import { Router } from 'express';
import { billingController } from '../controllers/billingController';
import { authenticate } from '../middleware/auth';
import { validate, body } from '../middleware/validate.js';
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
router.post(
  '/subscription',
  [
    body('planId').isString().trim().notEmpty().isLength({ max: 100 }),
    body('billingCycle').isIn(['monthly', 'yearly']).withMessage('Invalid billing cycle'),
    body('paymentMethodId').optional().isString().isLength({ max: 200 }),
    body('couponCode').optional().isString().isLength({ max: 100 }),
  ],
  validate,
  billingController.createSubscription
);
router.put(
  '/subscription',
  [
    body('planId').isString().trim().notEmpty().isLength({ max: 100 }),
    body('billingCycle').isIn(['monthly', 'yearly']).withMessage('Invalid billing cycle'),
  ],
  validate,
  billingController.updateSubscription
);
router.post(
  '/subscription/cancel',
  [body('immediately').optional().isBoolean()],
  validate,
  billingController.cancelSubscription
);
router.post('/subscription/reactivate', billingController.reactivateSubscription);

router.get('/invoices', billingController.getInvoices);
router.get('/usage', billingController.getUsage);

router.post('/setup-intent', billingController.createSetupIntent);
router.post(
  '/payment-method',
  [body('paymentMethodId').isString().trim().notEmpty().isLength({ max: 200 })],
  validate,
  billingController.updatePaymentMethod
);
router.post('/portal', billingController.createPortalSession);
router.post(
  '/validate-coupon',
  [body('code').isString().trim().notEmpty().isLength({ max: 100 })],
  validate,
  billingController.validateCoupon
);


export default router;
