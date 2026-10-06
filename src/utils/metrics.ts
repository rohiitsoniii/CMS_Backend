import promClient from 'prom-client';

// Create a Registry
export const register = new promClient.Registry();

// Add default metrics (CPU, Memory, Event Loop Lag, etc.)
promClient.collectDefaultMetrics({
  app: 'headless-cms',
  prefix: 'cms_',
  register,
});

// Custom Metrics
export const httpRequestDurationMicroseconds = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

export const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

export const contentPublishedTotal = new promClient.Counter({
  name: 'content_published_total',
  help: 'Total content published',
  labelNames: ['tenantId', 'contentType']
});

export const webhookDeliveryTotal = new promClient.Counter({
  name: 'webhook_delivery_total',
  help: 'Total webhook deliveries',
  labelNames: ['tenantId', 'status']
});

// Register all custom metrics
register.registerMetric(httpRequestDurationMicroseconds);
register.registerMetric(httpRequestsTotal);
register.registerMetric(contentPublishedTotal);
register.registerMetric(webhookDeliveryTotal);
