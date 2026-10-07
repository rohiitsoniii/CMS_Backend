import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Content, Project } from '../models/index.js';
import { SeoSettings } from '../models/SeoSettings.js';
import { Redirect, NotFoundLog, normalizePath } from '../models/Redirect.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { buildRobotsTxt, buildSitemapXml, buildLlmsTxt, buildMetaBundle } from '../services/geoService.js';

/**
 * Public SEO API for headless frontends — /api/v1/public/seo/:projectId/...
 * Only exposes published, indexable data. Proxy these from your site, e.g.
 * yoursite.com/sitemap.xml → .../sitemap.xml
 */

async function activeProject(req: Request) {
  const { projectId } = req.params;
  if (!Types.ObjectId.isValid(projectId)) throw new AppError('Not found', 404);
  const project = await Project.findOne({ _id: projectId, status: { $ne: 'archived' } }).select('_id').lean();
  if (!project) throw new AppError('Not found', 404);
  return String(project._id);
}

const cacheFor = (res: Response, seconds: number) => res.set('Cache-Control', `public, max-age=${seconds}, s-maxage=${seconds}`);

export const sitemap = asyncHandler(async (req: Request, res: Response) => {
  const projectId = await activeProject(req);
  cacheFor(res, 900);
  res.type('application/xml').send(await buildSitemapXml(projectId));
});

export const robots = asyncHandler(async (req: Request, res: Response) => {
  const projectId = await activeProject(req);
  cacheFor(res, 3600);
  res.type('text/plain').send(await buildRobotsTxt(projectId));
});

export const llms = asyncHandler(async (req: Request, res: Response) => {
  const projectId = await activeProject(req);
  const body = await buildLlmsTxt(projectId, false);
  if (!body) throw new AppError('Not found', 404);
  cacheFor(res, 3600);
  res.type('text/plain').send(body);
});

export const llmsFull = asyncHandler(async (req: Request, res: Response) => {
  const projectId = await activeProject(req);
  const body = await buildLlmsTxt(projectId, true);
  if (!body) throw new AppError('Not found', 404);
  cacheFor(res, 3600);
  res.type('text/plain').send(body);
});

/** IndexNow ownership file: serve at yoursite.com/{key}.txt */
export const indexNowKey = asyncHandler(async (req: Request, res: Response) => {
  const projectId = await activeProject(req);
  const settings = await SeoSettings.findOne({ projectId }).select('indexNow').lean();
  if (!settings?.indexNow?.enabled || !settings.indexNow.key) throw new AppError('Not found', 404);
  res.type('text/plain').send(settings.indexNow.key);
});

/** All active redirects — for build-time/edge middleware (Next.js, Netlify, Vercel). */
export const redirects = asyncHandler(async (req: Request, res: Response) => {
  const projectId = await activeProject(req);
  const list = await Redirect.find({ projectId, isActive: true }).select('from to statusCode -_id').lean();
  cacheFor(res, 300);
  res.json({ success: true, data: list });
});

/**
 * Resolve a path at request time: returns a redirect if one matches,
 * otherwise records a 404 (when ?notFound=1) so editors can fix it.
 */
export const resolvePath = asyncHandler(async (req: Request, res: Response) => {
  const projectId = await activeProject(req);
  const path = normalizePath(String(req.query.path || ''));
  const redirect = await Redirect.findOneAndUpdate(
    { projectId, from: path, isActive: true },
    { $inc: { hits: 1 }, $set: { lastHitAt: new Date() } },
    { new: true }
  ).lean();
  if (redirect) {
    res.json({ success: true, data: { type: redirect.statusCode === 410 ? 'gone' : 'redirect', statusCode: redirect.statusCode, to: redirect.to } });
    return;
  }
  if (req.query.notFound === '1' || req.query.notFound === 'true') {
    await NotFoundLog.updateOne(
      { projectId, path },
      {
        $inc: { hits: 1 },
        $set: { lastSeenAt: new Date(), lastReferrer: String(req.query.referrer || req.get('referer') || '').slice(0, 1000), resolved: false },
        $setOnInsert: { firstSeenAt: new Date() },
      },
      { upsert: true }
    );
  }
  res.json({ success: true, data: { type: 'none' } });
});

/** Full SEO bundle (title, meta tags, canonical, hreflang, JSON-LD) by slug or id. */
export const meta = asyncHandler(async (req: Request, res: Response) => {
  const projectId = await activeProject(req);
  const filter: any = { projectId, status: 'published', isDeleted: { $ne: true } };
  if (typeof req.query.id === 'string' && Types.ObjectId.isValid(req.query.id)) filter._id = req.query.id;
  else if (typeof req.query.slug === 'string' && req.query.slug) filter.slug = req.query.slug.slice(0, 300);
  else throw new AppError('Pass ?slug= or ?id=', 400);
  if (typeof req.query.type === 'string' && req.query.type) {
    filter.$or = [{ contentTypeApiId: req.query.type }, { type: req.query.type }];
  }
  const content = await Content.findOne(filter).lean();
  if (!content) throw new AppError('Not found', 404);
  cacheFor(res, 300);
  res.json({ success: true, data: await buildMetaBundle(projectId, content) });
});
