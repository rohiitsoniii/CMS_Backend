import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { Content, Project } from '../models/index.js';
import { asyncHandler } from '../middleware/index.js';

/**
 * Public popups/banners for popup.js — /api/v1/public/popups/:projectId
 *
 * Uses published content of type "popup" or "banner" (or content types with
 * apiId popup/banner). Display rules live in the entry's data:
 *   trigger: { type: 'delay'|'exit_intent'|'scroll'|'immediate', value }
 *   pages: ['/', '/blog/*'] (empty = all), excludePages: [...]
 *   device: 'all'|'desktop'|'mobile', frequency: 'once'|'session'|'always'
 *   startAt / endAt (ISO), position: 'center'|'bottom-right'|'top-bar'|'bottom-bar'
 *   title, body, imageUrl, ctaText, ctaUrl, collectEmail, emailTags
 */
const router = Router();

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 50) : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

router.get('/:projectId', asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  if (!Types.ObjectId.isValid(projectId) || !(await Project.exists({ _id: projectId, status: { $ne: 'archived' } }))) {
    res.status(404).json({ success: false });
    return;
  }
  const now = Date.now();
  const items = await Content.find({
    projectId,
    status: 'published',
    isDeleted: { $ne: true },
    $or: [{ type: { $in: ['popup', 'banner'] } }, { contentTypeApiId: { $in: ['popup', 'banner', 'popups', 'banners'] } }],
  }).select('name type contentTypeApiId data updatedAt').limit(50).lean();

  const popups = items
    .map((c: any) => {
      const d = c.data || {};
      const isBanner = c.type === 'banner' || /banner/.test(c.contentTypeApiId || '');
      return {
        id: String(c._id),
        version: new Date(c.updatedAt).getTime(),
        name: c.name,
        title: str(d.title || d.heading, 200),
        body: str(d.body || d.text || d.description, 2000),
        imageUrl: str(typeof d.image === 'object' ? d.image?.url : d.imageUrl || d.image, 500),
        ctaText: str(d.ctaText || d.buttonText || d.cta?.text, 80),
        ctaUrl: str(d.ctaUrl || d.buttonUrl || d.cta?.link || d.cta?.url, 500),
        collectEmail: Boolean(d.collectEmail || d.form?.fields?.includes?.('email')),
        emailTags: list(d.emailTags || d.tags),
        trigger: {
          type: ['delay', 'exit_intent', 'scroll', 'immediate'].includes(d.trigger?.type) ? d.trigger.type : isBanner ? 'immediate' : 'delay',
          value: Number(d.trigger?.value ?? d.trigger?.delay ?? 5) || 0,
        },
        pages: list(d.pages || d.display?.pages).filter((p: string) => p !== '*'),
        excludePages: list(d.excludePages),
        device: ['desktop', 'mobile'].includes(d.device) ? d.device : 'all',
        frequency: ['once', 'session', 'always'].includes(d.frequency || d.display?.frequency) ? (d.frequency || d.display?.frequency) : 'session',
        position: ['center', 'bottom-right', 'top-bar', 'bottom-bar'].includes(d.position) ? d.position : isBanner ? 'top-bar' : 'center',
        startAt: d.startAt ? new Date(d.startAt).getTime() : undefined,
        endAt: d.endAt ? new Date(d.endAt).getTime() : undefined,
      };
    })
    .filter((p) => (!p.startAt || p.startAt <= now) && (!p.endAt || p.endAt > now) && (p.title || p.body));

  res.set('Cache-Control', 'public, max-age=60');
  res.json({ success: true, data: popups });
}));

export default router;
