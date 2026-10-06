import { Request, Response } from 'express';
import { getSystemHealth } from '../utils/healthCheck.js';

export const statusController = {
  /**
   * Public Status Page details
   */
  getSystemStatus: async (_req: Request, res: Response) => {
    const health = getSystemHealth();
    
    // In a full implementation, this might fetch from an `Incident` collection
    // and historical `UptimeLog` collection.
    res.json({
      success: true,
      data: {
        status: health.status === 'ok' ? 'operational' : 'degraded',
        uptimePersentage: 99.98, // Mocked 90-day uptime
        components: {
          api: 'operational',
          database: health.dependencies.mongodb === 'connected' ? 'operational' : 'outage',
          cache: health.dependencies.redis === 'connected' ? 'operational' : 'degraded',
          cdn: 'operational'
        },
        activeIncidents: [],
        timestamp: new Date().toISOString()
      }
    });
  }
};
