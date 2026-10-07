import { Request, Response } from 'express';
import { BillingService } from '../services/billingService';
import { CouponService } from '../services/CouponService.js';
import { Plan } from '../models/Plan';
import { ProcessedStripeEvent } from '../models/ProcessedStripeEvent.js';
import { asyncHandler, AppError } from '../middleware/index.js';

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_key_for_development', {
  apiVersion: '2026-03-25.dahlia'
});

export const billingController = {
  // Get all plans
  getPlans: asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const plans = await Plan.find({ isActive: true }).sort({ order: 1 });
    res.json(plans);
    return;
  }),

  // Create subscription
  createSubscription: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { planId, billingCycle, paymentMethodId, couponCode } = req.body;

    const subscription = await BillingService.createSubscription(
      planId,
      billingCycle,
      paymentMethodId,
      couponCode
    );

    res.json(subscription);
    return;
  }),

  // Get current subscription
  getSubscription: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req.tenantId || req.user?.tenantId || (req.user as any)?.tenant)?.toString();
    const subscription = await BillingService.getSubscription(tenantId);
    res.json(subscription);
    return;
  }),

  // Update subscription (upgrade/downgrade)
  updateSubscription: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { planId, billingCycle } = req.body;
    const tenantId = req.user!.tenantId.toString();

    const subscription = await BillingService.updateSubscription(
      tenantId,
      planId,
      billingCycle
    );

    res.json(subscription);
    return;
  }),

  // Cancel subscription
  cancelSubscription: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { immediately } = req.body;
    const tenantId = req.user!.tenantId.toString();

    const subscription = await BillingService.cancelSubscription(
      tenantId,
      immediately
    );

    res.json(subscription);
    return;
  }),

  // Reactivate subscription
  reactivateSubscription: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.user!.tenantId.toString();
    const subscription = await BillingService.reactivateSubscription(tenantId);
    res.json(subscription);
    return;
  }),

  // Get invoices
  getInvoices: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.user!.tenantId.toString();
    const invoices = await BillingService.getInvoices(tenantId);
    res.json(invoices);
    return;
  }),

  // Update payment method
  updatePaymentMethod: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { paymentMethodId } = req.body;
    const tenantId = req.user!.tenantId.toString();

    const subscription = await BillingService.updatePaymentMethod(
      tenantId,
      paymentMethodId
    );

    res.json(subscription);
    return;
  }),

  // Create setup intent (for adding payment method)
  createSetupIntent: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.user!.tenantId.toString();
    const subscription = await BillingService.getSubscription(tenantId);

    if (!subscription) {
      throw new AppError('No subscription found', 404);
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: subscription.stripeCustomerId,
      payment_method_types: ['card']
    });

    res.json({ clientSecret: setupIntent.client_secret });
    return;
  }),

  // Get usage
  getUsage: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const tenantId = (req.tenantId || req.user?.tenantId || (req.user as any)?.tenant)?.toString();
    const usage = await BillingService.getUsage(tenantId);
    res.json(usage);
    return;
  }),

  // Stripe webhook — verified by signature against the RAW body
  // (app.ts exempts this path from express.json(); billingRoutes applies
  // express.raw()). Retried deliveries are deduplicated by event id.
  async handleWebhook(req: Request, res: Response) {
    try {
      const sig = req.headers['stripe-signature'] as string;
      if (!sig) {
        return res.status(400).json({ success: false, error: 'Missing Stripe signature' });
      }

      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
      if (!webhookSecret) {
        console.error('STRIPE_WEBHOOK_SECRET is not configured — rejecting webhook');
        return res.status(500).json({ success: false, error: 'Webhook receiver not configured' });
      }

      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ success: false, error: 'Invalid webhook payload encoding' });
      }

      let event: any;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid Stripe signature' });
      }

      // Idempotency: Stripe retries deliveries; process each event once
      try {
        await ProcessedStripeEvent.create({ eventId: event.id, type: event.type });
      } catch {
        return res.json({ received: true, duplicate: true });
      }

      await BillingService.handleWebhook(event);

      return res.json({ received: true });
    } catch (error: any) {
      console.error('Webhook error:', error.message);
      return res.status(400).json({ success: false, error: error.message });
    }
  },

  // Create billing portal session
  createPortalSession: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.user!.tenantId.toString();
    const subscription = await BillingService.getSubscription(tenantId);

    if (!subscription) {
      throw new AppError('No subscription found', 404);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/dashboard/billing`
    });

    res.json({ url: session.url });
    return;
  }),

  // Validate coupon
  validateCoupon: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { code, planSlug, amount } = req.body;

    if (!code) throw new AppError('Coupon code is required', 400);

    const coupon = await CouponService.validateCoupon(code, planSlug, amount);
    const discountedAmount = CouponService.calculateDiscount(coupon, amount);

    res.json({
      valid: true,
      code: coupon.code,
      discountType: coupon.discountType,
      value: coupon.value,
      originalAmount: amount,
      discountedAmount
    });
    return;
  })
};
