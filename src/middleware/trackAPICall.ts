import { Request, Response, NextFunction } from 'express';
import { analyticsService } from '../services/analyticsService';

export const trackAPICall = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  res.on('finish', async () => {
    try {
      if (req.user && req.path !== '/analytics/track') {
        const responseTime = Date.now() - startTime;
        
        await analyticsService.trackEvent({
          tenantId: req.user.tenant.toString(),
          userId: req.user._id.toString(),
          type: 'api_call',
          category: 'api',
          action: 'request',
          endpoint: req.path,
          method: req.method,
          statusCode: res.statusCode,
          responseTime,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          metadata: {
            query: req.query,
            params: req.params
          }
        });
      }
    } catch (error) {
      // Silently fail - don't break the request
      console.error('Analytics tracking error:', error);
    }
  });

  next();
};
