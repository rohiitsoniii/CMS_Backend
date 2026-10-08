import Stripe from 'stripe';
import { Subscription, type ISubscription } from '../models/Subscription';
import { Plan } from '../models/Plan';
import { Invoice } from '../models/Invoice';
import { Tenant } from '../models/Tenant';
import { CouponService } from './CouponService.js';
import { User } from '../models/User';
import { mailerService } from './mailerService.js';


const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_key_for_development', {
  apiVersion: '2026-03-25.dahlia'
});

/** True when a real Stripe key is configured. */
export const billingConfigured = () =>
  Boolean(process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('placeholder'));

const appUrl = () => (process.env.FRONTEND_URL || 'http://localhost:5174').replace(/\/+$/, '');

/** Email the workspace owner(s) about billing events. Never throws. */
async function notifyOwners(tenantId: unknown, subject: string, html: string) {
  try {
    const owners = await User.find({ tenantId, role: { $in: ['owner', 'admin'] }, isActive: { $ne: false } }).select('email').lean();
    const tenant = await Tenant.findById(tenantId).select('email').lean();
    const to = [...new Set([...owners.map((o: any) => o.email), (tenant as any)?.email].filter(Boolean))];
    if (to.length) await mailerService.send({ category: 'system', to, subject, html });
  } catch (err) {
    console.error('[billing] owner notification failed:', (err as Error).message);
  }
}

export class BillingService {
  // Create Stripe customer
  static async createCustomer(tenantId: string, email: string, name: string) {
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: { tenantId }
    });

    return customer;
  }

  // Create subscription
  static async createSubscription(
    tenantId: string,
    planId: string,
    billingCycle: 'monthly' | 'yearly',
    paymentMethodId?: string,
    couponCode?: string
  ) {

    const plan = await Plan.findById(planId);
    if (!plan) throw new Error('Plan not found');

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw new Error('Tenant not found');

    // Create or get Stripe customer
    let stripeCustomerId = tenant.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await this.createCustomer(
        tenantId,
        tenant.email || '',
        tenant.name || ''
      );
      stripeCustomerId = customer.id;
      await Tenant.findByIdAndUpdate(tenantId, { stripeCustomerId });
    }

    // Attach payment method if provided
    if (paymentMethodId) {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: stripeCustomerId
      });

      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId
        }
      });
    }

    const stripePriceId = billingCycle === 'monthly' 
      ? plan.stripePriceId.monthly 
      : plan.stripePriceId.yearly;

    // Handle Coupon
    let stripeCouponId = undefined;
    if (couponCode) {
      const amount = billingCycle === 'monthly' ? plan.price.monthly : plan.price.yearly;
      const coupon = await CouponService.validateCoupon(couponCode, plan.slug, amount);
      
      // We either use a pre-existing Stripe coupon with the same ID, 
      // or we create a one-time Stripe coupon if it's an internal-only coupon.
      // For simplicity/robustness, we'll try to use the code as the coupon ID.
      try {
        await stripe.coupons.retrieve(coupon.code);
        stripeCouponId = coupon.code;
      } catch (e) {
        // If it doesn't exist on Stripe, we create it dynamically
        const stripeCoupon = await stripe.coupons.create({
          id: coupon.code,
          percent_off: coupon.discountType === 'percentage' ? coupon.value : undefined,
          amount_off: coupon.discountType === 'fixed' ? (coupon.value * 100) : undefined,
          currency: coupon.currency,
          duration: 'once', 
          metadata: { internalCouponId: coupon._id.toString() }
        });
        stripeCouponId = stripeCoupon.id;
      }
    }

    const stripeSubscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: stripePriceId }],
      trial_period_days: 14, // 14-day free trial
      ...(stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
      metadata: { tenantId, planId, couponCode: couponCode || '' }
    } as any);

    // If coupon was used, increment internal usage
    if (couponCode) {
      await CouponService.incrementUsage(couponCode);
    }


    // Create subscription record
    const stripeSubAny = stripeSubscription as any;
    const subscription = await Subscription.create({
      tenantId,
      planId,
      stripeCustomerId,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId,
      status: stripeSubscription.status,
      billingCycle,
      currentPeriodStart: new Date((stripeSubAny.current_period_start ?? Math.floor(Date.now() / 1000)) * 1000),
      currentPeriodEnd: new Date((stripeSubAny.current_period_end ?? (Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60)) * 1000),
      trialEnd: stripeSubAny.trial_end
        ? new Date(stripeSubAny.trial_end * 1000)
        : undefined
    });

    return subscription;
  }

  // Update subscription (upgrade/downgrade)
  static async updateSubscription(
    tenantId: string,
    newPlanId: string,
    newBillingCycle: 'monthly' | 'yearly'
  ) {
    const subscription = await Subscription.findOne({ tenantId });
    if (!subscription) throw new Error('Subscription not found');

    const newPlan = await Plan.findById(newPlanId);
    if (!newPlan) throw new Error('Plan not found');

    const newStripePriceId = newBillingCycle === 'monthly'
      ? newPlan.stripePriceId.monthly
      : newPlan.stripePriceId.yearly;

    // Update Stripe subscription
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId
    );

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      items: [{
        id: stripeSubscription.items.data[0].id,
        price: newStripePriceId
      }],
      proration_behavior: 'create_prorations'
    });

    // Update local subscription
    subscription.planId = newPlanId as any;
    subscription.stripePriceId = newStripePriceId;
    subscription.billingCycle = newBillingCycle;
    await subscription.save();

    return subscription;
  }

  // Cancel subscription
  static async cancelSubscription(tenantId: string, immediately: boolean = false) {
    const subscription = await Subscription.findOne({ tenantId });
    if (!subscription) throw new Error('Subscription not found');

    if (immediately) {
      await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
      subscription.status = 'canceled';
      subscription.canceledAt = new Date();
    } else {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true
      });
      subscription.cancelAtPeriodEnd = true;
    }

    await subscription.save();
    return subscription;
  }

  // Reactivate subscription
  static async reactivateSubscription(tenantId: string) {
    const subscription = await Subscription.findOne({ tenantId });
    if (!subscription) throw new Error('Subscription not found');

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false
    });

    subscription.cancelAtPeriodEnd = false;
    subscription.status = 'active';
    await subscription.save();

    return subscription;
  }

  // Get subscription details
  static async getSubscription(tenantId: string) {
    const subscription = await Subscription.findOne({ tenantId })
      .populate('planId');
    
    if (!subscription) return null;

    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId
    );

    return {
      ...subscription.toObject(),
      stripeData: stripeSubscription
    };
  }

  // Get invoices
  static async getInvoices(tenantId: string) {
    return Invoice.find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(50);
  }

  // Update payment method
  static async updatePaymentMethod(tenantId: string, paymentMethodId: string) {
    const subscription = await Subscription.findOne({ tenantId });
    if (!subscription) throw new Error('Subscription not found');

    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: subscription.stripeCustomerId
    });

    await stripe.customers.update(subscription.stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId
      }
    });

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    
    subscription.paymentMethod = {
      brand: paymentMethod.card?.brand || '',
      last4: paymentMethod.card?.last4 || '',
      expMonth: paymentMethod.card?.exp_month || 0,
      expYear: paymentMethod.card?.exp_year || 0
    };

    await subscription.save();
    return subscription;
  }

  // Handle Stripe webhook
  static async handleWebhook(event: any) {
    switch ((event as any).type) {
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated((event as any).data.object as any);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted((event as any).data.object as any);
        break;

      case 'invoice.paid':
        await this.handleInvoicePaid((event as any).data.object as any);
        break;

      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed((event as any).data.object as any);
        break;
    }
  }

  private static async handleSubscriptionUpdated(stripeSubscription: any) {
    const subscription = await Subscription.findOne({
      stripeSubscriptionId: (stripeSubscription as any).id
    });

    if (subscription) {
      subscription.status = (stripeSubscription as any).status as any;
      const subAny = stripeSubscription as any;
      subscription.currentPeriodStart = new Date((subAny.current_period_start ?? Math.floor(Date.now() / 1000)) * 1000);
      subscription.currentPeriodEnd = new Date((subAny.current_period_end ?? (Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60)) * 1000);
      await subscription.save();
    }
  }

  private static async handleSubscriptionDeleted(stripeSubscription: any) {
    const subscription = await Subscription.findOne({
      stripeSubscriptionId: (stripeSubscription as any).id
    });

    if (subscription) {
      subscription.status = 'canceled';
      subscription.canceledAt = new Date();
      await subscription.save();

      // Fall back to the free plan so limits match what is being paid for
      await Tenant.updateOne({ _id: subscription.tenantId }, { 'subscription.plan': 'free' });
      await notifyOwners(
        subscription.tenantId,
        'Your subscription has ended',
        `<p>Your subscription has been cancelled and your workspace is now on the Free plan.</p>
         <p>Your content is safe. To restore your plan's limits, <a href="${appUrl()}/dashboard/billing">choose a plan</a>.</p>`
      );
    }
  }

  private static async handleInvoicePaid(stripeInvoice: any) {
    const invAny = stripeInvoice as any;
    const subscription = await Subscription.findOne({
      stripeCustomerId: invAny.customer as string
    });

    if (subscription) {
      await Invoice.create({
        tenantId: subscription.tenantId,
        subscriptionId: subscription._id,
        stripeInvoiceId: invAny.id,
        number: invAny.number || '',
        amount: (invAny.amount_paid ?? 0) / 100,
        currency: invAny.currency,
        status: 'paid',
        paidAt: new Date(((invAny.status_transitions?.paid_at ?? Math.floor(Date.now() / 1000))) * 1000),
        invoiceUrl: invAny.hosted_invoice_url || undefined,
        invoicePdf: invAny.invoice_pdf || undefined,
        items: (invAny.lines?.data ?? []).map((line: any) => ({
          description: line.description || '',
          amount: (line.amount ?? 0) / 100,
          quantity: line.quantity || 1
        }))
      });
    }
  }

  private static async handleInvoicePaymentFailed(stripeInvoice: any) {
    const invAny = stripeInvoice as any;
    const subscription = await Subscription.findOne({
      stripeCustomerId: invAny.customer as string
    });

    if (subscription) {
      subscription.status = 'past_due';
      await subscription.save();

      const amount = typeof invAny.amount_due === 'number'
        ? `${(invAny.amount_due / 100).toFixed(2)} ${String(invAny.currency || '').toUpperCase()}`
        : 'your invoice';
      const retry = invAny.next_payment_attempt ? new Date(invAny.next_payment_attempt * 1000).toDateString() : null;
      await notifyOwners(
        subscription.tenantId,
        'Action needed: your payment failed',
        `<p>We couldn't charge ${amount} for your subscription.</p>
         ${retry ? `<p>We'll retry on <strong>${retry}</strong>.</p>` : ''}
         <p>Please <a href="${appUrl()}/dashboard/billing">update your payment method</a> to avoid losing access to paid features.</p>
         ${invAny.hosted_invoice_url ? `<p>You can also <a href="${invAny.hosted_invoice_url}">pay the invoice directly</a>.</p>` : ''}`
      );
    }
  }

  // Get usage for tenant
  static async getUsage(tenantId: string) {
    const subscription = await Subscription.findOne({ tenantId });
    if (subscription && subscription.usage) return subscription.usage;

    const tenant = await Tenant.findById(tenantId);
    const tenantUsage = tenant?.usage as any;
    return {
      projects: { used: 1, limit: 1 },
      contentItems: { used: tenantUsage?.contentItems || 0, limit: 1000 },
      teamMembers: { used: 1, limit: 2 },
      storage: { used: tenantUsage?.storageUsed || 0, limit: 10 },
      apiCalls: { used: tenantUsage?.apiCalls || 0, limit: 10000 }
    };
  }

  // Update usage
  static async updateUsage(tenantId: string, updates: Partial<ISubscription['usage']>) {
    const subscription = await Subscription.findOne({ tenantId });
    if (!subscription) throw new Error('Subscription not found');

    Object.assign(subscription.usage, updates);
    await subscription.save();

    return subscription.usage;
  }

  // Reset monthly usage
  static async resetMonthlyUsage(tenantId: string) {
    const subscription = await Subscription.findOne({ tenantId });
    if (!subscription) return;

    subscription.usage.apiCallsThisMonth = 0;
    subscription.usage.lastResetAt = new Date();
    await subscription.save();
  }
}

// Export Subscription type
export type { ISubscription } from '../models/Subscription';

/**
 * Bill the monthly platform fee for workspaces that bring their own AI key.
 * Adds a pending Stripe invoice item (picked up by the next subscription
 * invoice). Idempotent per month via AIProviderConfig.feeBilledMonth and a
 * Stripe idempotency key.
 */
export async function billByokFees(): Promise<number> {
  if (!billingConfigured()) return 0;
  const { AIProviderConfig } = await import('../models/AIProviderConfig.js');
  const { BYOK_MONTHLY_FEE_USD } = await import('./aiGateway.js');
  const fee = Math.round(BYOK_MONTHLY_FEE_USD() * 100);
  if (fee <= 0) return 0;
  const month = new Date().toISOString().slice(0, 7);
  let billed = 0;
  const configs = await AIProviderConfig.find({ isActive: true, feeBilledMonth: { $ne: month } }).limit(500);
  for (const cfg of configs) {
    const sub = await Subscription.findOne({ tenantId: cfg.tenantId, status: { $in: ['active', 'trialing', 'past_due'] } });
    if (!sub?.stripeCustomerId) continue;
    try {
      await stripe.invoiceItems.create(
        { customer: sub.stripeCustomerId, amount: fee, currency: 'usd', description: `AI bring-your-own-key platform fee (${month})` },
        { idempotencyKey: `byok-${cfg.tenantId}-${month}` }
      );
      cfg.feeBilledMonth = month;
      await cfg.save();
      billed++;
    } catch (err) {
      console.error('[billing] BYOK fee failed for', String(cfg.tenantId), (err as Error).message);
    }
  }
  return billed;
}
