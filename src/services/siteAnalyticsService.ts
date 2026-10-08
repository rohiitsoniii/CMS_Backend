import crypto from 'crypto';
import { Types, PipelineStage } from 'mongoose';
import { SiteEvent } from '../models/SiteEvent.js';
import { config } from '../config/index.js';

/**
 * Website analytics: event ingestion + reports.
 */

const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor|curl|wget|python-requests|axios|node-fetch|facebookexternalhit|embedly/i;

export function parseUserAgent(ua: string) {
  const s = ua || '';
  const device: 'desktop' | 'mobile' | 'tablet' = /ipad|tablet|kindle|playbook|silk/i.test(s) || (/android/i.test(s) && !/mobile/i.test(s))
    ? 'tablet'
    : /mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(s) ? 'mobile' : 'desktop';
  const browser = /edg\//i.test(s) ? 'Edge'
    : /opr\/|opera/i.test(s) ? 'Opera'
    : /samsungbrowser/i.test(s) ? 'Samsung Internet'
    : /chrome|crios/i.test(s) ? 'Chrome'
    : /firefox|fxios/i.test(s) ? 'Firefox'
    : /safari/i.test(s) ? 'Safari' : 'Other';
  const os = /windows/i.test(s) ? 'Windows'
    : /iphone|ipad|ipod|ios/i.test(s) ? 'iOS'
    : /mac os|macintosh/i.test(s) ? 'macOS'
    : /android/i.test(s) ? 'Android'
    : /linux/i.test(s) ? 'Linux' : 'Other';
  return { device, browser, os, isBot: BOT_UA.test(s) || !s };
}

/** Daily-rotating anonymous visitor id: no cookie, no stored IP. */
export function visitorHash(projectId: string, ip: string, ua: string, day = new Date().toISOString().slice(0, 10)) {
  return crypto.createHmac('sha256', `${config.apiKeySecret}:${day}`).update(`${projectId}|${ip}|${ua}`).digest('base64url').slice(0, 22);
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined) || undefined;

export interface CollectInput {
  type?: string;
  name?: string;
  url?: string;
  title?: string;
  referrer?: string;
  sessionId?: string;
  props?: Record<string, unknown>;
  value?: number;
}

export async function recordEvent(projectId: string, input: CollectInput, ctx: { ip: string; ua: string; country?: string }) {
  const ua = parseUserAgent(ctx.ua);
  if (ua.isBot) return false;

  let path = '/';
  let utm: Record<string, string | undefined> = {};
  let ownHost = '';
  try {
    const u = new URL(String(input.url || ''));
    ownHost = u.host;
    path = (u.pathname || '/').slice(0, 500);
    utm = {
      source: clean(u.searchParams.get('utm_source'), 100),
      medium: clean(u.searchParams.get('utm_medium'), 100),
      campaign: clean(u.searchParams.get('utm_campaign'), 150),
    };
  } catch {
    return false;
  }

  let referrerHost: string | undefined;
  try {
    if (input.referrer) {
      const r = new URL(String(input.referrer));
      if (r.host !== ownHost) referrerHost = r.host.replace(/^www\./, '').slice(0, 200);
    }
  } catch { /* ignore */ }

  const props = input.props && typeof input.props === 'object'
    ? Object.fromEntries(Object.entries(input.props).slice(0, 10).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 200)]))
    : undefined;

  await SiteEvent.create({
    projectId,
    type: input.type === 'event' ? 'event' : 'pageview',
    name: input.type === 'event' ? clean(input.name, 80) || 'event' : undefined,
    path,
    title: clean(input.title, 300),
    referrerHost,
    utm: utm.source || utm.medium || utm.campaign ? utm : undefined,
    device: ua.device,
    browser: ua.browser,
    os: ua.os,
    country: clean(ctx.country, 2)?.toUpperCase(),
    visitorId: visitorHash(projectId, ctx.ip, ctx.ua),
    sessionId: clean(input.sessionId, 64) || visitorHash(projectId, ctx.ip, ctx.ua),
    props,
    value: typeof input.value === 'number' && Number.isFinite(input.value) ? input.value : undefined,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface Range { from: Date; to: Date }

const match = (projectId: string, range: Range, extra: Record<string, unknown> = {}) => ({
  $match: { projectId: new Types.ObjectId(projectId), createdAt: { $gte: range.from, $lte: range.to }, ...extra },
});

async function top(projectId: string, range: Range, field: string, extra: Record<string, unknown> = {}, limit = 10) {
  const rows = await SiteEvent.aggregate([
    match(projectId, range, { type: 'pageview', [field]: { $nin: [null, ''] }, ...extra }),
    { $group: { _id: `$${field}`, views: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } },
    { $project: { _id: 0, key: '$_id', views: 1, visitors: { $size: '$visitors' } } },
    { $sort: { visitors: -1, views: -1 } },
    { $limit: limit },
  ] as PipelineStage[]);
  return rows as Array<{ key: string; views: number; visitors: number }>;
}

export async function report(projectId: string, range: Range) {
  const days = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000));
  const bucket = days <= 2 ? '%Y-%m-%dT%H:00' : '%Y-%m-%d';

  const [totals] = await SiteEvent.aggregate([
    match(projectId, range, { type: 'pageview' }),
    { $group: { _id: null, pageviews: { $sum: 1 }, visitors: { $addToSet: '$visitorId' }, sessions: { $addToSet: '$sessionId' } } },
    { $project: { _id: 0, pageviews: 1, visitors: { $size: '$visitors' }, sessions: { $size: '$sessions' } } },
  ] as PipelineStage[]);

  const [bounce] = await SiteEvent.aggregate([
    match(projectId, range, { type: 'pageview' }),
    { $group: { _id: '$sessionId', n: { $sum: 1 } } },
    { $group: { _id: null, sessions: { $sum: 1 }, single: { $sum: { $cond: [{ $eq: ['$n', 1] }, 1, 0] } } } },
  ] as PipelineStage[]);

  const series = await SiteEvent.aggregate([
    match(projectId, range, { type: 'pageview' }),
    { $group: { _id: { $dateToString: { format: bucket, date: '$createdAt' } }, pageviews: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } },
    { $project: { _id: 0, t: '$_id', pageviews: 1, visitors: { $size: '$visitors' } } },
    { $sort: { t: 1 } },
  ] as PipelineStage[]);

  const events = await SiteEvent.aggregate([
    match(projectId, range, { type: 'event' }),
    { $group: { _id: '$name', count: { $sum: 1 }, visitors: { $addToSet: '$visitorId' }, value: { $sum: { $ifNull: ['$value', 0] } } } },
    { $project: { _id: 0, name: '$_id', count: 1, visitors: { $size: '$visitors' }, value: 1 } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ] as PipelineStage[]);

  const [pages, referrers, sources, campaigns, devices, browsers, countries] = await Promise.all([
    top(projectId, range, 'path'),
    top(projectId, range, 'referrerHost'),
    top(projectId, range, 'utm.source'),
    top(projectId, range, 'utm.campaign'),
    top(projectId, range, 'device', {}, 5),
    top(projectId, range, 'browser', {}, 8),
    top(projectId, range, 'country', {}, 15),
  ]);

  const t = totals || { pageviews: 0, visitors: 0, sessions: 0 };
  return {
    range: { from: range.from, to: range.to },
    totals: {
      ...t,
      pagesPerSession: t.sessions ? Math.round((t.pageviews / t.sessions) * 10) / 10 : 0,
      bounceRate: bounce?.sessions ? Math.round((bounce.single / bounce.sessions) * 1000) / 10 : 0,
    },
    series,
    pages,
    referrers,
    sources,
    campaigns,
    devices,
    browsers,
    countries,
    events: events.map((e: any) => ({ ...e, conversionRate: t.visitors ? Math.round((e.visitors / t.visitors) * 1000) / 10 : 0 })),
  };
}

/** Live visitors in the last 5 minutes. */
export async function realtime(projectId: string) {
  const since = new Date(Date.now() - 5 * 60_000);
  const [row] = await SiteEvent.aggregate([
    { $match: { projectId: new Types.ObjectId(projectId), createdAt: { $gte: since } } },
    { $group: { _id: null, visitors: { $addToSet: '$visitorId' } } },
    { $project: { _id: 0, visitors: { $size: '$visitors' } } },
  ] as PipelineStage[]);
  return { visitors: row?.visitors || 0 };
}
