import { Request, Response, NextFunction } from 'express';
import { Tenant, User, ErrorLog, Coupon, Project, Content } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';

export const systemController = {
  /**
   * Get platform-wide statistics
   */
  getStats: asyncHandler(async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const [
      tenantCount,
      userCount,
      projectCount,
      contentCount,
      errorCount,
      activeCoupons
    ] = await Promise.all([
      Tenant.countDocuments(),
      User.countDocuments(),
      Project.countDocuments(),
      Content.countDocuments(),
      ErrorLog.countDocuments({ isFixed: false }),
      Coupon.countDocuments({ isActive: true })
    ]);

    res.json({
      success: true,
      data: {
        tenants: tenantCount,
        users: userCount,
        projects: projectCount,
        content: contentCount,
        openErrors: errorCount,
        activeCoupons: activeCoupons,
        systemStatus: 'healthy',
        uptime: process.uptime()
      }
    });
  }),

  /**
   * Get list of all tenants
   */
  getTenants: asyncHandler(async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const tenants = await Tenant.find()
      .select('name slug email subscription isActive createdAt')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { tenants }
    });
  }),

  /**
   * Get system error logs
   */
  getErrorLogs: asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { severity, isFixed, page = 1, limit = 20 } = req.query;
    
    const query: any = {};
    if (severity) query.severity = severity;
    if (isFixed !== undefined) query.isFixed = isFixed === 'true';

    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      ErrorLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('userId', 'firstName lastName email')
        .populate('tenantId', 'name slug'),
      ErrorLog.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          page: Number(page),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  }),

  /**
   * Mark error as fixed
   */
  markErrorFixed: asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { id } = req.params;
    const log = await ErrorLog.findByIdAndUpdate(
      id,
      { 
        isFixed: true, 
        fixedBy: req.userId,
        fixedAt: new Date()
      },
      { new: true }
    );


    if (!log) throw new AppError('Log not found', 404);

    res.json({
      success: true,
      data: { log }
    });
  }),

  /**
   * Coupon Management: Create
   */
  createCoupon: asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const coupon = await Coupon.create(req.body);
    res.status(201).json({
      success: true,
      data: { coupon }
    });
  }),

  /**
   * Coupon Management: List
   */
  getCoupons: asyncHandler(async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      data: { coupons }
    });
  }),

  /**
   * Log critical errors from frontend
   */
  logFrontendError: asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { message, stack, severity, url, source, lineno, colno } = req.body;
    
    const log = await ErrorLog.create({
      message: `[Frontend] ${message}`,
      stack,
      statusCode: req.body.statusCode || 500,
      severity: severity || 'medium',
      metadata: { url, source, lineno, colno },
      tenantId: req.tenantId,
      userId: req.userId,
      path: url || '/frontend',
      method: 'UI_EVENT'
    });

    res.status(201).json({
      success: true,
      data: { id: log._id }
    });
  }),

  /**
   * Real-time Log Streaming via Server-Sent Events (SSE)
   */
  streamLogs: (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE

    const keepAlive = setInterval(() => {
      res.write(':\n\n'); // SSE comment to keep connection alive
    }, 15000);

    const logListener = (logEvent: any) => {
      // Optional filtering could go here based on req.query
      res.write(`data: ${JSON.stringify(logEvent)}\n\n`);
    };

    import('../utils/logger.js').then(({ logStreamEmitter }) => {
      logStreamEmitter.on('log', logListener);

      req.on('close', () => {
        clearInterval(keepAlive);
        logStreamEmitter.removeListener('log', logListener);
        res.end();
      });
    }).catch((err) => {
      console.error('Failed to attach log stream emitter', err);
      res.end();
    });
  }
};

