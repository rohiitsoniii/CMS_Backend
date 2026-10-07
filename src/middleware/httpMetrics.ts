import { Request, Response, NextFunction } from 'express';
import { httpRequestDurationMicroseconds, httpRequestsTotal } from '../utils/metrics.js';

const SKIPPED_PATHS = new Set(['/api/v1/metrics', '/live', '/health', '/ready', '/api/v1/live']);

/**
 * Records HTTP request count + duration into Prometheus metrics.
 * Route labels use the matched route pattern to avoid high cardinality.
 */
export const httpMetrics = (req: Request, res: Response, next: NextFunction): void => {
  if (SKIPPED_PATHS.has(req.path)) {
    next();
    return;
  }
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      // req.route is populated by the time the response finishes, so
      // labels use the matched pattern (/content/:id) instead of raw
      // paths — except 404s, which collapse to a single label.
      const route = req.route?.path
        ? `${req.baseUrl || ''}${req.route.path}`
        : res.statusCode === 404
          ? 'not-found'
          : req.path;
      const labels = {
        method: req.method,
        route,
        status_code: String(res.statusCode),
      };
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      httpRequestsTotal.inc(labels);
      httpRequestDurationMicroseconds.observe(labels, durationSeconds);
    } catch {
      // Metrics must never break requests
    }
  });
  next();
};
