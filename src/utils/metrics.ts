import {
  Registry,
  collectDefaultMetrics,
  Histogram,
  Counter,
} from 'prom-client';

/**
 * Real Prometheus metrics (prom-client is a production dependency).
 * Served at GET /api/v1/metrics (see healthRoutes).
 */
export const register = new Registry();

collectDefaultMetrics({ prefix: 'cms_', register, labels: { app: 'headless-cms' } });

export const httpRequestDurationMicroseconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  registers: [register],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const contentPublishedTotal = new Counter({
  name: 'content_published_total',
  help: 'Total content published',
  labelNames: ['tenantId', 'contentType'],
  registers: [register],
});

export const webhookDeliveryTotal = new Counter({
  name: 'webhook_delivery_total',
  help: 'Total webhook deliveries',
  labelNames: ['tenantId', 'status'],
  registers: [register],
});
