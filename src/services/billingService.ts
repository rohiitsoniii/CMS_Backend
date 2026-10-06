import Stripe from 'stripe';
import { Subscription } from '../models/Subscription';
import { Plan } from '../models/Plan';
import { Invoice } from '../models/Invoice';
import { Tenant } from '../models/Tenant';
import { CouponService } from './CouponService.js';


const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_key_for_development', {
  apiVersion: '2024-12-18.acacia'
});

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
      coupon: stripeCouponId,
      metadata: { tenantId, planId, couponCode: couponCode || '' }
    });

    // If coupon was used, increment internal usage
    if (couponCode) {
      await CouponService.incrementUsage(couponCode);
    }


    // Create subscription record
    const subscription = await Subscription.create({
      tenantId,
      planId,
      stripeCustomerId,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId,
      status: stripeSubscription.status,
      billingCycle,
      currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
      trialEnd: stripeSubscription.trial_end 
        ? new Date(stripeSubscription.trial_end * 1000) 
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
  static async handleWebhook(event: Stripe.Event) {
    switch (event.type) {
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      
      case 'invoice.paid':
        await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
    }
  }

  private static async handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription) {
    const subscription = await Subscription.findOne({
      stripeSubscriptionId: stripeSubscription.id
    });

    if (subscription) {
      subscription.status = stripeSubscription.status as any;
      subscription.currentPeriodStart = new Date(stripeSubscription.current_period_start * 1000);
      subscription.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
      await subscription.save();
    }
  }

  private static async handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription) {
    const subscription = await Subscription.findOne({
      stripeSubscriptionId: stripeSubscription.id
    });

    if (subscription) {
      subscription.status = 'canceled';
      subscription.canceledAt = new Date();
      await subscription.save();
    }
  }

  private static async handleInvoicePaid(stripeInvoice: Stripe.Invoice) {
    const subscription = await Subscription.findOne({
      stripeCustomerId: stripeInvoice.customer as string
    });

    if (subscription) {
      await Invoice.create({
        tenantId: subscription.tenantId,
        subscriptionId: subscription._id,
        stripeInvoiceId: stripeInvoice.id,
        number: stripeInvoice.number || '',
        amount: stripeInvoice.amount_paid / 100,
        currency: stripeInvoice.currency,
        status: 'paid',
        paidAt: new Date(stripeInvoice.status_transitions.paid_at! * 1000),
        invoiceUrl: stripeInvoice.hosted_invoice_url || undefined,
        invoicePdf: stripeInvoice.invoice_pdf || undefined,
        items: stripeInvoice.lines.data.map(line => ({
          description: line.description || '',
          amount: line.amount / 100,
          quantity: line.quantity || 1
        }))
      });
    }
  }

  private static async handleInvoicePaymentFailed(stripeInvoice: Stripe.Invoice) {
    const subscription = await Subscription.findOne({
      stripeCustomerId: stripeInvoice.customer as string
    });

    if (subscription) {
      subscription.status = 'past_due';
      await subscription.save();

      // TODO: Send email notification about failed payment
    }
  }

  // Get subscription for tenant
  static async getSubscription(tenantId: string) {
    const subscription = await Subscription.findOne({ tenantId }).populate('planId');
    if (subscription) return subscription;

    // Fallback: check tenant subscription status or default free plan
    const tenant = await Tenant.findById(tenantId);
    const planSlug = tenant?.subscription?.plan || 'free';
    const plan = (await Plan.findOne({ slug: planSlug })) || (await Plan.findOne({ slug: 'free' }));

    return {
      _id: 'sub_free_' + tenantId,
      tenantId,
      plan: plan || {
        name: 'Free',
        slug: 'free',
        price: { monthly: 0, yearly: 0 },
        limits: {
          projects: 1,
          contentItems: 1000,
          teamMembers: 2,
          storage: 10,
          apiCallsPerMonth: 10000,
          apiRateLimit: 100
        },
        features: ['1 project', '1,000 content items', 'Community support']
      },
      status: 'active',
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      isFreeTier: true
    };
  }

  // Get usage for tenant
  static async getUsage(tenantId: string) {
    const subscription = await Subscription.findOne({ tenantId });
    if (subscription && subscription.usage) return subscription.usage;

    const tenant = await Tenant.findById(tenantId);
    return {
      projects: { used: 1, limit: 1 },
      contentItems: { used: tenant?.usage?.contentItems || 0, limit: 1000 },
      teamMembers: { used: 1, limit: 2 },
      storage: { used: tenant?.usage?.storageUsed || 0, limit: 10 },
      apiCalls: { used: tenant?.usage?.apiCalls || 0, limit: 10000 }
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
