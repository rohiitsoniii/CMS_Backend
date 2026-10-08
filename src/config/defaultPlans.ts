import { Plan } from '../models/Plan.js';

/**
 * Built-in plan catalogue. Used by the seed script, by first-boot seeding
 * (when the plans collection is empty) and as the quota fallback for
 * workspaces that have no paid Stripe subscription.
 */
export const DEFAULT_PLANS = [
  {
    name: 'Free',
    slug: 'free',
    description: 'Perfect for trying out the platform',
    price: {
      monthly: 0,
      yearly: 0
    },
    stripePriceId: {
      monthly: 'price_free_monthly', // Replace with actual Stripe price ID
      yearly: 'price_free_yearly'
    },
    limits: {
      projects: 1,
      contentItems: 1000,
      teamMembers: 2,
      storage: 10, // GB
      apiCallsPerMonth: 10000,
      apiRateLimit: 100 // requests per minute
    },
    features: [
      '1 project',
      '1,000 content items',
      '2 team members',
      '10GB storage',
      '10,000 API calls/month',
      'Community support'
    ],
    isActive: true,
    order: 1
  },
  {
    name: 'Starter',
    slug: 'starter',
    description: 'For freelancers and small teams',
    price: {
      monthly: 29,
      yearly: 290 // Save 17%
    },
    stripePriceId: {
      monthly: 'price_starter_monthly', // Replace with actual Stripe price ID
      yearly: 'price_starter_yearly'
    },
    limits: {
      projects: 3,
      contentItems: 10000,
      teamMembers: 5,
      storage: 50,
      apiCallsPerMonth: 100000,
      apiRateLimit: 500
    },
    features: [
      '3 projects',
      '10,000 content items',
      '5 team members',
      '50GB storage',
      '100,000 API calls/month',
      'Email support',
      'Webhooks',
      'Localization'
    ],
    isActive: true,
    order: 2
  },
  {
    name: 'Professional',
    slug: 'professional',
    description: 'For growing businesses and agencies',
    price: {
      monthly: 99,
      yearly: 990
    },
    stripePriceId: {
      monthly: 'price_professional_monthly',
      yearly: 'price_professional_yearly'
    },
    limits: {
      projects: 10,
      contentItems: 100000,
      teamMembers: 15,
      storage: 200,
      apiCallsPerMonth: 1000000,
      apiRateLimit: 2000
    },
    features: [
      '10 projects',
      '100,000 content items',
      '15 team members',
      '200GB storage',
      '1M API calls/month',
      'Priority support',
      'All features unlocked',
      'Custom domains',
      'Advanced workflows',
      'Audit logs'
    ],
    isActive: true,
    order: 3
  },
  {
    name: 'Business',
    slug: 'business',
    description: 'For mid-market companies',
    price: {
      monthly: 299,
      yearly: 2990
    },
    stripePriceId: {
      monthly: 'price_business_monthly',
      yearly: 'price_business_yearly'
    },
    limits: {
      projects: 50,
      contentItems: 1000000,
      teamMembers: 50,
      storage: 1000,
      apiCallsPerMonth: 10000000,
      apiRateLimit: 10000
    },
    features: [
      '50 projects',
      '1M content items',
      '50 team members',
      '1TB storage',
      '10M API calls/month',
      '24/7 support',
      'SSO (Single Sign-On)',
      'SLA guarantee (99.9% uptime)',
      'Dedicated account manager',
      'Custom integrations'
    ],
    isActive: true,
    order: 4
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'For large enterprises',
    price: {
      monthly: 999,
      yearly: 9990
    },
    stripePriceId: {
      monthly: 'price_enterprise_monthly',
      yearly: 'price_enterprise_yearly'
    },
    limits: {
      projects: 999999,
      contentItems: 999999999,
      teamMembers: 999999,
      storage: 999999,
      apiCallsPerMonth: 999999999,
      apiRateLimit: 99999
    },
    features: [
      'Unlimited projects',
      'Unlimited content',
      'Unlimited team members',
      'Unlimited storage',
      'Unlimited API calls',
      'White-label option',
      'On-premise deployment',
      'Custom SLA',
      'Dedicated infrastructure',
      'Custom development',
      'Training & onboarding'
    ],
    isActive: true,
    order: 5
  }
];

export type PlanLimits = (typeof DEFAULT_PLANS)[number]['limits'];

/** Tenant.subscription.plan uses older names; map them onto catalogue slugs. */
const TENANT_PLAN_ALIASES: Record<string, string> = { basic: 'starter', pro: 'professional' };

export function planSlugFor(tenantPlan?: string): string {
  const slug = tenantPlan || 'free';
  return TENANT_PLAN_ALIASES[slug] || slug;
}

/** Limits for a plan slug from the built-in catalogue (unknown slugs get Free). */
export function defaultPlanLimits(slug?: string): PlanLimits {
  const s = planSlugFor(slug);
  return (DEFAULT_PLANS.find((p) => p.slug === s) || DEFAULT_PLANS[0]).limits;
}

/** Insert the built-in plans on first boot so pricing and quotas work out of the box. */
export async function ensureDefaultPlans(): Promise<void> {
  if (await Plan.estimatedDocumentCount()) return;
  await Plan.insertMany(DEFAULT_PLANS, { ordered: false }).catch(() => undefined);
}
