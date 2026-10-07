import express from 'express';
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;
const enabled = Boolean(dsn);

if (enabled) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

/**
 * Request middleware — no-op router (the SDK instruments via diagnostics
 * channel once init() runs). Kept as a mountable router so app.ts wiring
 * stays stable whether or not a DSN is configured.
 */
export const sentryMiddleware = express.Router();

/**
 * Error middleware — must be mounted BEFORE the app's own error handler
 * so exceptions reach Sentry with request context.
 */
export const errorMiddleware = express.Router();

if (enabled) {
  errorMiddleware.use(Sentry.expressErrorHandler());
}

export function captureException(error: Error, context?: Record<string, unknown>) {
  if (enabled) {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } else if (process.env.NODE_ENV !== 'test') {
    console.error('Error:', error.message, context);
  }
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  if (enabled) {
    Sentry.captureMessage(message, level);
  }
}

export const isSentryEnabled = (): boolean => enabled;

export default Sentry;
