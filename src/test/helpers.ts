import request from 'supertest';
import type { Express } from 'express';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Role } from '../models/Role.js';
import { Plan } from '../models/Plan.js';
import { Subscription } from '../models/Subscription.js';

export interface TestAuth {
  userId: string;
  tenantId: string;
  accessToken: string;
  refreshToken: string;
  email: string;
}

const DEFAULT_PASSWORD = 'Password123';

/** Register a fresh tenant+owner via the public API. */
export const registerOwner = async (
  app: Express,
  overrides: Record<string, string> = {}
): Promise<{ res: request.Response; auth?: TestAuth }> => {
  const payload = {
    name: 'Test User',
    email: 'owner@example.com',
    password: DEFAULT_PASSWORD,
    ...overrides,
  };
  const res = await request(app).post('/api/v1/auth/register').send(payload);
  if (res.status !== 201) return { res };
  const { user, tenant, tokens } = res.body.data;
  return {
    res,
    auth: {
      userId: user.id,
      tenantId: tenant.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      email: payload.email,
    },
  };
};

export const authHeader = (auth: TestAuth): Record<string, string> => ({
  Authorization: `Bearer ${auth.accessToken}`,
});

/** Ensure a Plan + active Subscription so quota middleware passes. */
export const ensureSubscription = async (tenantId: string): Promise<void> => {
  let plan = await Plan.findOne({ slug: 'test-plan' });
  if (!plan) {
    plan = await Plan.create({
      name: 'Test Plan',
      slug: 'test-plan',
      description: 'Plan for automated tests',
      price: { monthly: 0, yearly: 0 },
      stripePriceId: { monthly: 'price_test_m', yearly: 'price_test_y' },
      limits: {
        projects: 100,
        contentItems: 100000,
        teamMembers: 100,
        storage: 100,
        apiCallsPerMonth: 1000000,
        apiRateLimit: 1000,
      },
      features: [],
    });
  }
  const existing = await Subscription.findOne({ tenantId });
  if (!existing) {
    await Subscription.create({
      tenantId,
      planId: plan._id,
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
      stripePriceId: 'price_test_m',
      status: 'active',
      billingCycle: 'monthly',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });
  }
};

/** Create a project + seed default roles so team invites resolve. */
export const createProjectWithRoles = async (
  app: Express,
  auth: TestAuth,
  slug = 'test-project'
): Promise<string> => {
  await ensureSubscription(auth.tenantId);
  const res = await request(app)
    .post('/api/v1/projects')
    .set(authHeader(auth))
    .send({ name: 'Test Project', slug });
  if (res.status !== 201) {
    throw new Error(`Project creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const projectId: string = res.body.data.project._id || res.body.data.project.id;
  await (Role as unknown as { createDefaultRoles: (p: string, u: string) => Promise<unknown> }).createDefaultRoles(
    projectId,
    auth.userId
  );
  return projectId;
};

/** Read the hashed reset token directly (emails are stubbed in tests). */
export const getResetTokenHash = async (email: string): Promise<string | undefined> => {
  const user = await User.findOne({ email });
  return user?.passwordResetToken;
};

export { DEFAULT_PASSWORD, Project };
