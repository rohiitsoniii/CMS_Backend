import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import routes from '../routes/index.js';
import {
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
} from '../middleware/index.js';
import { csrfProtection } from '../middleware/cookies.js';
import { aiContextMiddleware } from '../services/aiGateway.js';

/**
 * Minimal Express app for tests — same router as production but without
 * DB connections, Redis, rate-limit quota middleware, websockets, or listen().
 * Mirrors the root-level liveness probes from src/app.ts.
 * Each test file gets a fresh rate-limiter/memory state via module isolation.
 */
export const createTestApp = (): Express => {
  const app = express();
  // Mirror production (src/app.ts): the Stripe webhook path is exempted
  // from express.json() so billingRoutes' express.raw() sees the raw body.
  const stripeWebhookPath = '/api/v1/billing/webhook';
  app.use((req, res, next) => {
    if (req.originalUrl === stripeWebhookPath) return next();
    express.json()(req, res, next);
  });
  app.use(express.urlencoded({ extended: true }));
  app.use(requestIdMiddleware);
  app.use(cookieParser());
  app.use(csrfProtection);
  // Root liveness probes (mirrors src/app.ts for container health checks)
  app.get(['/live', '/health', '/ready'], (_req, res) => {
    res.status(200).json({ status: 'ok', success: true, timestamp: new Date().toISOString() });
  });
  app.use('/api/v1', aiContextMiddleware);
  app.use('/api/v1', routes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
