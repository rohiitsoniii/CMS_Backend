import { Request } from 'express';
import { AuditLog } from '../models/index.js';

export class AuditService {
  /**
   * Log an activity to the audit trail
   */
  static async log(
    req: Request,
    action: string,
    resource: { type: string; id: string; name?: string },
    metadata?: Record<string, any>,
    status: 'success' | 'failure' = 'success'
  ): Promise<void> {
    try {
      // Skip logging if no tenant context (should catch in auth middleware usually, but for safety)
      if (!req.tenantId) {
        console.warn('AuditLog skipped: No tenantId in request');
        return;
      }

      const logEntry = new AuditLog({
        tenantId: req.tenantId,
        actor: {
          userId: req.user?._id,
          type: req.user ? 'user' : 'system', // Can be refined if using API keys
          name: req.user ? `${req.user.firstName} ${req.user.lastName}` : 'System',
          email: req.user?.email,
        },
        action,
        resource,
        metadata,
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get('User-Agent'),
        status,
      });

      await logEntry.save();
    } catch (error) {
      // We don't want audit logging failure to crash the main request, 
      // but we should log the error to system logs
      console.error('Failed to write audit log:', error);
    }
  }
}
