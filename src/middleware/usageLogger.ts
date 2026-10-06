import { Request, Response, NextFunction } from 'express';
import { UsageLog } from '../models/index.js';

/**
 * Middleware to log API usage for analytics
 */
export const usageLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startTime = Date.now();
  
  // Capture original end function
  const originalEnd = res.end;
  
  // Override end function to capture response
  res.end = function(chunk?: unknown, encoding?: BufferEncoding | (() => void), callback?: () => void): Response {
    const responseTime = Date.now() - startTime;
    
    // Only log if we have tenant info
    if (req.tenantId) {
      // Determine event type based on method
      let eventType: 'api_call' | 'content_create' | 'content_update' | 'content_delete' = 'api_call';
      
      if (req.path.includes('/content')) {
        if (req.method === 'POST') eventType = 'content_create';
        else if (req.method === 'PUT' || req.method === 'PATCH') eventType = 'content_update';
        else if (req.method === 'DELETE') eventType = 'content_delete';
      }
      
      // Create usage log (async, don't wait)
      UsageLog.create({
        tenantId: req.tenantId,
        apiKeyId: req.apiKey?._id,
        userId: req.userId,
        eventType,
        endpoint: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        responseTime,
        requestSize: parseInt(req.headers['content-length'] || '0', 10),
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer,
      }).catch(err => {
        console.error('Failed to log usage:', err.message);
      });
    }
    
    // Call original end
    if (typeof encoding === 'function') {
      return originalEnd.call(this, chunk, encoding);
    }
    return originalEnd.call(this, chunk, encoding, callback);
  };
  
  next();
};

/**
 * Request logging middleware for development
 */
export const requestLogger = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  next();
};
