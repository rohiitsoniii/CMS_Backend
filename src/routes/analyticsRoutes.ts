import { Router } from 'express';
import { analyticsController } from '../controllers/analyticsController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/dashboard', analyticsController.getDashboard);
router.get('/api-usage', analyticsController.getAPIUsage);
router.get('/user-activity', analyticsController.getUserActivity);
router.get('/content-operations', analyticsController.getContentOperations);
router.get('/revenue', analyticsController.getRevenueMetrics);
router.get('/top-endpoints', analyticsController.getTopEndpoints);
router.get('/error-rate', analyticsController.getErrorRate);
router.post('/track', analyticsController.trackEvent);
router.get('/content/:contentId', analyticsController.getContentAnalytics);

router.get('/overview', (req, res) => {
  res.json({
    success: true,
    data: {
      overview: {
        totalPageViews: 12450,
        uniqueVisitors: 3820,
        totalSessions: 4910,
        avgSessionDuration: 245,
        bounceRate: 28.4
      },
      dailyData: [
        { date: new Date().toISOString().slice(0, 10), pageViews: 1420, visitors: 390 }
      ]
    }
  });
});

router.get('/pages', (req, res) => {
  res.json({
    success: true,
    data: [
      { path: '/blog/announcement', views: 3200, uniqueViews: 2100, avgTime: 180 },
      { path: '/docs/getting-started', views: 2800, uniqueViews: 1900, avgTime: 240 },
      { path: '/pricing', views: 1900, uniqueViews: 1400, avgTime: 95 }
    ]
  });
});

router.get('/referrers', (req, res) => {
  res.json({
    success: true,
    data: [
      { referrer: 'google.com', count: 4800, percentage: 48.2 },
      { referrer: 'direct', count: 3100, percentage: 31.1 },
      { referrer: 'github.com', count: 1200, percentage: 12.0 }
    ]
  });
});

router.get('/devices', (req, res) => {
  res.json({
    success: true,
    data: {
      devices: [
        { device: 'Desktop', count: 6800, percentage: 68 },
        { device: 'Mobile', count: 2700, percentage: 27 },
        { device: 'Tablet', count: 500, percentage: 5 }
      ]
    }
  });
});

router.get('/geographic', (req, res) => {
  res.json({
    success: true,
    data: [
      { country: 'United States', code: 'US', visitors: 4200 },
      { country: 'United Kingdom', code: 'GB', visitors: 1800 },
      { country: 'Germany', code: 'DE', visitors: 1100 },
      { country: 'India', code: 'IN', visitors: 950 }
    ]
  });
});

router.get('/realtime', (req, res) => {
  res.json({
    success: true,
    data: {
      currentPages: [
        { path: '/blog/announcement', activeUsers: 8 },
        { path: '/docs', activeUsers: 4 }
      ]
    }
  });
});

export default router;
