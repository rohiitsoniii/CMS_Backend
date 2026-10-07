import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { logger } from '../utils/logger.js';

export const ipAllowlist = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.tenant) {
    return next();
  }

  const allowedIps = req.tenant.settings?.allowedIps || [];

  if (allowedIps.length === 0) {
    // If no IPS configured, skip allowing everything
    return next();
  }

  // Handle IPs from proxies (nginx/ALBs)
  const clientIp = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();

  // Simple CIDR logic omitted for brevity; this assumes direct exact matches for MVP IP allowlisting.
  const isAllowed = allowedIps.includes(clientIp) || allowedIps.includes('*');

  if (!isAllowed) {
    logger.warn({ ip: clientIp, tenantId: req.tenantId }, 'IP Allowlist Rejection');
    next(new AppError('Forbidden: Your IP address is not allowed to access this resource.', 403));
    return;
  }

  next();
};
