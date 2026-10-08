import { Router } from 'express';
import { billingController } from '../controllers/billingController';
import { authenticate, requirePermission } from '../middleware/auth';
import { billingConfigured } from '../services/billingService';
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

// Owners/admins always pass; other roles need explicit billing permissions
const canManage = requirePermission('billing:manage');
const canRead = requirePermission('billing:read');

// Stripe calls fail confusingly with a placeholder key — say so plainly
const requireStripe = (_req: any, res: any, next: any) => {
  if (billingConfigured()) return next();
  res.status(503).json({ success: false, message: 'Billing is not configured on this installation (missing STRIPE_SECRET_KEY).' });
};

router.get('/subscription', canRead, billingController.getSubscription);
router.post(
  '/subscription',
  canManage,
  [
    body('planId').isString().trim().notEmpty().isLength({ max: 100 }),
    body('billingCycle').isIn(['monthly', 'yearly']).withMessage('Invalid billing cycle'),
    body('paymentMethodId').optional().isString().isLength({ max: 200 }),
    body('couponCode').optional().isString().isLength({ max: 100 }),
  ],
  validate,
  requireStripe,
  billingController.createSubscription
);
router.put(
  '/subscription',
  canManage,
  [
    body('planId').isString().trim().notEmpty().isLength({ max: 100 }),
    body('billingCycle').isIn(['monthly', 'yearly']).withMessage('Invalid billing cycle'),
  ],
  validate,
  requireStripe,
  billingController.updateSubscription
);
router.post(
  '/subscription/cancel',
  canManage,
  [body('immediately').optional().isBoolean()],
  validate,
  requireStripe,
  billingController.cancelSubscription
);
router.post('/subscription/reactivate', canManage, requireStripe, billingController.reactivateSubscription);

router.get('/invoices', canRead, billingController.getInvoices);
router.get('/usage', canRead, billingController.getUsage);

router.post('/setup-intent', canManage, requireStripe, billingController.createSetupIntent);
router.post(
  '/payment-method',
  canManage,
  [body('paymentMethodId').isString().trim().notEmpty().isLength({ max: 200 })],
  validate,
  requireStripe,
  billingController.updatePaymentMethod
);
router.post('/portal', canManage, requireStripe, billingController.createPortalSession);
router.post(
  '/validate-coupon',
  [body('code').isString().trim().notEmpty().isLength({ max: 100 })],
  validate,
  billingController.validateCoupon
);


export default router;
