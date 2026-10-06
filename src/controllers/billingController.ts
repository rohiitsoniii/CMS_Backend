import { Request, Response } from 'express';
import { BillingService } from '../services/billingService';
import { CouponService } from '../services/CouponService.js';
import { Plan } from '../models/Plan';

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_key_for_development', {
  apiVersion: '2024-12-18.acacia'
});

export const billingController = {
  // Get all plans
  async getPlans(req: Request, res: Response) {
    try {
      const plans = await Plan.find({ isActive: true }).sort({ order: 1 });
      res.json(plans);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Create subscription
  async createSubscription(req: Request, res: Response) {
    try {
      const { planId, billingCycle, paymentMethodId, couponCode } = req.body;
      const tenantId = req.user!.tenantId;

      const subscription = await BillingService.createSubscription(
        tenantId,
        planId,
        billingCycle,
        paymentMethodId,
        couponCode
      );

      res.json(subscription);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get current subscription
  async getSubscription(req: Request, res: Response) {
    try {
      const tenantId = (req.tenantId || req.user?.tenantId || (req.user as any)?.tenant)?.toString();
      const subscription = await BillingService.getSubscription(tenantId);
      res.json(subscription);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Update subscription (upgrade/downgrade)
  async updateSubscription(req: Request, res: Response) {
    try {
      const { planId, billingCycle } = req.body;
      const tenantId = req.user!.tenantId;

      const subscription = await BillingService.updateSubscription(
        tenantId,
        planId,
        billingCycle
      );

      res.json(subscription);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Cancel subscription
  async cancelSubscription(req: Request, res: Response) {
    try {
      const { immediately } = req.body;
      const tenantId = req.user!.tenantId;

      const subscription = await BillingService.cancelSubscription(
        tenantId,
        immediately
      );

      res.json(subscription);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Reactivate subscription
  async reactivateSubscription(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const subscription = await BillingService.reactivateSubscription(tenantId);
      res.json(subscription);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get invoices
  async getInvoices(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const invoices = await BillingService.getInvoices(tenantId);
      res.json(invoices);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Update payment method
  async updatePaymentMethod(req: Request, res: Response) {
    try {
      const { paymentMethodId } = req.body;
      const tenantId = req.user!.tenantId;

      const subscription = await BillingService.updatePaymentMethod(
        tenantId,
        paymentMethodId
      );

      res.json(subscription);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Create setup intent (for adding payment method)
  async createSetupIntent(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const subscription = await BillingService.getSubscription(tenantId);

      if (!subscription) {
        return res.status(404).json({ error: 'No subscription found' });
      }

      const setupIntent = await stripe.setupIntents.create({
        customer: subscription.stripeCustomerId,
        payment_method_types: ['card']
      });

      res.json({ clientSecret: setupIntent.client_secret });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get usage
  async getUsage(req: Request, res: Response) {
    try {
      const tenantId = (req.tenantId || req.user?.tenantId || (req.user as any)?.tenant)?.toString();
      const usage = await BillingService.getUsage(tenantId);
      res.json(usage);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Stripe webhook
  async handleWebhook(req: Request, res: Response) {
    try {
      const sig = req.headers['stripe-signature'] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        webhookSecret
      );

      await BillingService.handleWebhook(event);

      res.json({ received: true });
    } catch (error: any) {
      console.error('Webhook error:', error.message);
      res.status(400).json({ error: error.message });
    }
  },

  // Create billing portal session
  async createPortalSession(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const subscription = await BillingService.getSubscription(tenantId);

      if (!subscription) {
        return res.status(404).json({ error: 'No subscription found' });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        return_url: `${process.env.FRONTEND_URL}/dashboard/billing`
      });

      res.json({ url: session.url });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Validate coupon
  async validateCoupon(req: Request, res: Response) {
    try {
      const { code, planSlug, amount } = req.body;
      
      if (!code) throw new Error('Coupon code is required');
      
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
    } catch (error: any) {
      res.status(400).json({
        valid: false,
        error: error.message
      });
    }
  }
};

