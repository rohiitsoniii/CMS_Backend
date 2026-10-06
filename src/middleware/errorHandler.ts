import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { ErrorLog } from '../models/ErrorLog.js';


// Custom error class
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Error handler middleware
export const errorHandler = async (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> => {
  // Default values
  let statusCode = 500;
  let message = 'Internal server error';
  let isOperational = false;
  let code: string | undefined;

  // Handle AppError
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    isOperational = err.isOperational;
    code = err.code;
  }

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
    isOperational = true;
  }

  // Handle Mongoose duplicate key error
  if (err.name === 'MongoServerError' && (err as Error & { code: number }).code === 11000) {
    statusCode = 409;
    message = 'Duplicate entry. This resource already exists.';
    isOperational = true;
  }

  // Handle Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
    isOperational = true;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    isOperational = true;
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    isOperational = true;
  }

  // Capture error with Sentry in production
  if (process.env.SENTRY_DSN && !isOperational) {
    try {
      const Sentry = await import('@sentry/node');
      Sentry.captureException(err, {
        extra: {
          statusCode,
          path: req.path,
          method: req.method,
        },
      });
    } catch (sentryError) {
      console.error('Sentry capture error:', sentryError);
    }
  }

  // Log error in development
  if (config.nodeEnv === 'development') {
    console.error('Error:', {
      message: err.message,
      stack: err.stack,
      statusCode,
    });
  } else if (!isOperational) {
    console.error('Unexpected error:', err);
  }

  // Phase 6: Log critical errors to database
  if (!isOperational || statusCode >= 500) {
    try {
      await ErrorLog.create({
        message: err.message,
        stack: err.stack,
        statusCode,
        userId: (req as any).user?._id,
        tenantId: (req as any).tenant?._id,
        path: req.path,
        method: req.method,
        requestId: req.requestId,
        params: req.params,
        body: req.method !== 'GET' ? req.body : undefined,
        severity: statusCode >= 500 ? 'high' : 'medium',
        isOperational
      });
    } catch (dbError) {
      console.error('Failed to log error to database:', dbError);
    }
  }

  // Send response

  const response: Record<string, unknown> = {
    success: false,
    error: message,
  };

  if (code) {
    response.code = code;
  }

  // Include stack trace in development
  if (config.nodeEnv === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

// Not found handler
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
};

// Async handler wrapper to catch async errors
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
