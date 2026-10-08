import express, { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Types } from 'mongoose';
import { Project } from '../models/index.js';
import { asyncHandler, AppError, authenticateJWT, requirePermission } from '../middleware/index.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { recordEvent, report, realtime } from '../services/siteAnalyticsService.js';

/**
 * Website analytics.
 *   Public:  POST /api/v1/public/analytics/:projectId/collect   (tracker.js)
 *   Private: GET  /api/v1/projects/:projectId/site-analytics      (reports)
 */

export const publicRouter = Router();

const collectLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

// sendBeacon posts text/plain; parse it as JSON
publicRouter.post(
  '/:projectId/collect',
  collectLimiter,
  express.text({ type: 'text/plain', limit: '16kb' }),
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    let body: any = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    // Respect Do-Not-Track / Global Privacy Control
    if (req.get('dnt') === '1' || req.get('sec-gpc') === '1' || !Types.ObjectId.isValid(projectId)) {
      res.status(204).end();
      return;
    }
    const exists = await Project.exists({ _id: projectId, status: { $ne: 'archived' } });
    if (exists) {
      await recordEvent(projectId, body || {}, {
        ip: req.ip || '',
        ua: req.get('user-agent') || '',
        country: req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || req.get('cloudfront-viewer-country') || undefined,
      }).catch(() => undefined);
    }
    res.status(204).end();
  })
);

export const privateRouter = Router({ mergeParams: true });
privateRouter.use(authenticateJWT, requireProjectAccess, requirePermission('content:read'));

function parseRange(req: Request) {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const days = Math.min(400, Math.max(1, parseInt(String(req.query.days || '30'), 10) || 30));
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - days * 86_400_000);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) throw new AppError('Invalid date range', 400);
  return { from, to };
}

privateRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await report(req.params.projectId, parseRange(req)) });
}));

privateRouter.get('/realtime', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await realtime(req.params.projectId) });
}));
