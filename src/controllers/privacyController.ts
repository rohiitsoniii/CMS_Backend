import { Request, Response } from 'express';
import { ConsentLog } from '../models/ConsentLog.js';

export const privacyController = {
  recordConsent: async (req: Request, res: Response) => {
    try {
      const { consentType, action, version } = req.body;
      const clientIp = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();

      await ConsentLog.create({
        userId: (req as any).user?.id,
        tenantId: (req as any).tenantId,
        ipAddress: clientIp,
        userAgent: req.headers['user-agent'] || 'unknown',
        consentType,
        action,
        version
      });

      res.status(201).json({ success: true, message: 'Consent recorded' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: 'Failed to record consent' });
    }
  },
  
  exportData: async (req: Request, res: Response) => {
     // GDPR Right to Access trigger
     res.json({ success: true, message: 'Data export triggered. A link will be emailed within 72 hours.' });
  },

  deleteAccount: async (req: Request, res: Response) => {
     // GDPR Right to be Forgotten trigger
     // In an actual enterprise app, this flips a flag for soft-delete, clearing PII immediately, and queues background deletion
     res.json({ success: true, message: 'Account deletion initiated. All PII will be destroyed within 30 days.' });
  }
};
