import { Router } from 'express';
import { getSystemHealth } from '../utils/healthCheck.js';
import { statusController } from '../controllers/statusController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// Liveness probe (Kubernetes /live) - Returns 200 as long as the server is running
router.get('/live', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness probe (Kubernetes /ready) - Returns 200 only if dependencies (DB) are ready
router.get('/ready', (_req, res) => {
  const health = getSystemHealth();
  if (health.status === 'ok') {
    res.status(200).json(health);
  } else {
    res.status(503).json(health);
  }
});

// General health check with full details
router.get('/health', (_req, res) => {
  res.status(200).json({
    ...getSystemHealth(),
    features: {
      dynamicSchema: true,
      localization: true,
      versionControl: true,
      workflows: true,
      scheduling: true
    }
  });
});

// System Status for StatusPage
router.get('/status', statusController.getSystemStatus);

// Metrics scrape endpoint for Prometheus.
// Process metrics fingerprint the host — require auth in production
// unless explicitly exposed (METRICS_PUBLIC=true for scrapers).
const metricsGate =
  process.env.NODE_ENV === 'production' && process.env.METRICS_PUBLIC !== 'true'
    ? [authenticateJWT]
    : [];
router.get('/metrics', ...metricsGate, async (_req, res) => {
  try {
    const { register } = await import('../utils/metrics.js');
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

export default router;
