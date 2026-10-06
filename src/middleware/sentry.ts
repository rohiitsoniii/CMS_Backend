import express from 'express';
import Sentry from '@sentry/node';
import { config } from './index.js';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express(),
      new Sentry.Integrations.MongoDB(),
    ],
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      if (process.env.NODE_ENV === 'development') {
        return null;
      }
      return event;
    },
  });
}

export const sentryMiddleware = express();

if (process.env.SENTRY_DSN) {
  sentryMiddleware.use(Sentry.Handlers.requestHandler());
  sentryMiddleware.use(Sentry.Handlers.tracingHandler());
}

export const errorMiddleware = express();

if (process.env.SENTRY_DSN) {
  errorMiddleware.use(Sentry.Handlers.errorHandler());
}

export function captureException(error: Error, context?: any) {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error, { extra: context });
  }
  console.error('Error:', error.message, context);
}

export function captureMessage(message: string, level: Sentry.Severity = Sentry.Severity.Info) {
  if (process.env.SENTRY_DSN) {
    Sentry.captureMessage(message, level);
  }
}

export default Sentry;