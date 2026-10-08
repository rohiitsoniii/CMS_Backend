import crypto from 'crypto';
import axios from 'axios';
import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Content, Project } from '../models/index.js';
import { SeoSettings, AI_CRAWLERS } from '../models/SeoSettings.js';
import { Redirect, NotFoundLog, normalizePath } from '../models/Redirect.js';
import { KeywordRank } from '../models/KeywordRank.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { analyzeGeo, buildMetaBundle, loadSeoContext } from '../services/geoService.js';
import { contentPath, normalizeSiteUrl, seoPingService } from '../services/seoPingService.js';
import { checkKeywordRank, rankProviderConfigured } from '../services/seoRankService.js';
import * as gsc from '../services/searchConsoleService.js';
import { aiGateway } from '../services/aiGateway.js';

/**
 * SEO suite (authenticated): settings, IndexNow, redirects, 404s, GEO score,
 * structured data preview, PageSpeed, keyword ranks.
 * Routes live under /api/v1/projects/:projectId/seo (project ownership is
 * enforced by requireProjectAccess on the router).
 */

const pid = (req: Request) => new Types.ObjectId(req.params.projectId);

const DEFAULT_URL_PATTERNS = [
  { contentType: 'blog', pattern: '/blog/{slug}', includeInSitemap: true, changefreq: 'weekly', priority: 0.7 },
  { contentType: 'page', pattern: '/{slug}', includeInSitemap: true, changefreq: 'monthly', priority: 0.8 },
];

async function tenantOf(req: Request) {
  const project = await Project.findById(req.params.projectId).select('tenantId name domain').lean();
  if (!project) throw new AppError('Project not found', 404);
  return project as any;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const getSettings = asyncHandler(async (req: Request, res: Response) => {
  const project = await tenantOf(req);
  let settings = await SeoSettings.findOne({ projectId: pid(req) });
  if (!settings) {
    settings = await SeoSettings.create({
      projectId: pid(req),
      tenantId: project.tenantId,
      siteUrl: normalizeSiteUrl(project.domain) || undefined,
      siteName: project.name,
      urlPatterns: DEFAULT_URL_PATTERNS,
    });
  }
  const publicBase = `${(process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')}/api/v1/public/seo/${req.params.projectId}`;
  res.json({
    success: true,
    data: {
      settings,
      aiCrawlers: AI_CRAWLERS,
      endpoints: {
        sitemap: `${publicBase}/sitemap.xml`,
        robots: `${publicBase}/robots.txt`,
        llms: `${publicBase}/llms.txt`,
        llmsFull: `${publicBase}/llms-full.txt`,
        redirects: `${publicBase}/redirects`,
        resolve: `${publicBase}/resolve?path=/some-path`,
        meta: `${publicBase}/meta?slug=your-slug`,
      },
      integrations: {
        rankTracking: rankProviderConfigured(),
        pageSpeedKey: Boolean(process.env.PAGESPEED_API_KEY),
        searchConsole: gsc.gscConfigured(),
      },
    },
  });
});

const ALLOWED_FIELDS = ['siteUrl', 'siteName', 'titleTemplate', 'defaultDescription', 'defaultOgImage', 'twitterHandle', 'defaultLocale', 'defaultPattern'];

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const project = await tenantOf(req);
  const body = req.body || {};
  const settings = (await SeoSettings.findOne({ projectId: pid(req) }))
    || new SeoSettings({ projectId: pid(req), tenantId: project.tenantId, siteName: project.name, urlPatterns: DEFAULT_URL_PATTERNS });

  for (const k of ALLOWED_FIELDS) if (body[k] !== undefined) (settings as any)[k] = body[k];
  if (body.siteUrl !== undefined) {
    const norm = body.siteUrl ? normalizeSiteUrl(body.siteUrl) : null;
    if (body.siteUrl && !norm) throw new AppError('Site URL is not valid', 400);
    settings.siteUrl = norm || undefined;
  }
  if (Array.isArray(body.urlPatterns)) {
    settings.urlPatterns = body.urlPatterns
      .filter((p: any) => p?.contentType && typeof p.pattern === 'string' && p.pattern.includes('{slug}'))
      .slice(0, 100);
  }
  if (body.verification) settings.verification = { ...settings.verification, ...body.verification };
  if (body.organization) {
    settings.organization = {
      ...(settings.organization as any),
      ...body.organization,
      sameAs: Array.isArray(body.organization.sameAs) ? body.organization.sameAs.filter((u: string) => /^https?:\/\//.test(u)).slice(0, 20) : settings.organization?.sameAs || [],
    };
  }
  if (body.llms) settings.llms = { ...(settings.llms as any), ...body.llms };
  if (body.aiCrawlers && typeof body.aiCrawlers === 'object') {
    const map = new Map<string, 'allow' | 'block'>();
    for (const [bot, policy] of Object.entries(body.aiCrawlers)) {
      if (bot in AI_CRAWLERS && (policy === 'allow' || policy === 'block')) map.set(bot, policy);
    }
    settings.aiCrawlers = map;
  }
  if (body.indexNow) {
    settings.indexNow.enabled = Boolean(body.indexNow.enabled);
    if (settings.indexNow.enabled && !settings.indexNow.key) settings.indexNow.key = crypto.randomBytes(16).toString('hex');
  }
  settings.updatedBy = req.user?._id as any;
  await settings.save();
  res.json({ success: true, data: settings, message: 'SEO settings saved' });
});

export const indexNowSubmitAll = asyncHandler(async (req: Request, res: Response) => {
  const { settings, site } = await loadSeoContext(req.params.projectId);
  if (!settings?.indexNow?.enabled || !settings.indexNow.key) throw new AppError('Enable IndexNow first', 400);
  if (!site) throw new AppError('Set your site URL first', 400);
  const items = await Content.find({ projectId: pid(req), status: 'published', isDeleted: { $ne: true }, 'seo.noIndex': { $ne: true } })
    .select('slug type contentTypeApiId').limit(10_000).lean();
  const urls = items.map((c) => contentPath(c as any, settings)).filter(Boolean).map((p) => `${site}${p}`);
  if (!urls.length) throw new AppError('No published pages with URLs to submit', 400);
  await seoPingService.ping(settings, site, urls);
  if (settings.indexNow.lastError) throw new AppError(settings.indexNow.lastError, 502);
  res.json({ success: true, message: `Submitted ${urls.length} URLs to IndexNow (Bing, Yandex and partners)` });
});

// ---------------------------------------------------------------------------
// Redirects & 404s
// ---------------------------------------------------------------------------

function validateRedirect(body: any) {
  const from = normalizePath(body.from || '');
  const statusCode = Number(body.statusCode || 301);
  if (!from || from === '/') throw new AppError('Enter the old path to redirect from', 400);
  if (![301, 302, 307, 308, 410].includes(statusCode)) throw new AppError('Invalid status code', 400);
  const to = statusCode === 410 ? undefined : String(body.to || '').trim();
  if (statusCode !== 410) {
    if (!to) throw new AppError('Enter where to redirect to', 400);
    if (!to.startsWith('/') && !/^https?:\/\//i.test(to)) throw new AppError('Destination must be a path (/new) or full URL', 400);
    if (normalizePath(to) === from && to.startsWith('/')) throw new AppError('A redirect cannot point to itself', 400);
  }
  return { from, to, statusCode: statusCode as 301, isActive: body.isActive !== false, note: body.note };
}

export const listRedirects = asyncHandler(async (req: Request, res: Response) => {
  const redirects = await Redirect.find({ projectId: pid(req) }).sort({ updatedAt: -1 }).limit(5000);
  res.json({ success: true, data: redirects });
});

export const createRedirect = asyncHandler(async (req: Request, res: Response) => {
  const project = await tenantOf(req);
  const data = validateRedirect(req.body || {});
  try {
    const redirect = await Redirect.create({ ...data, projectId: pid(req), tenantId: project.tenantId, createdBy: req.user?._id });
    await NotFoundLog.updateOne({ projectId: pid(req), path: data.from }, { resolved: true });
    res.status(201).json({ success: true, data: redirect });
  } catch (err: any) {
    if (err.code === 11000) throw new AppError('A redirect for this path already exists', 409);
    throw err;
  }
});

export const updateRedirect = asyncHandler(async (req: Request, res: Response) => {
  const data = validateRedirect(req.body || {});
  const redirect = await Redirect.findOneAndUpdate({ _id: req.params.id, projectId: pid(req) }, data, { new: true });
  if (!redirect) throw new AppError('Redirect not found', 404);
  res.json({ success: true, data: redirect });
});

export const deleteRedirect = asyncHandler(async (req: Request, res: Response) => {
  await Redirect.deleteOne({ _id: req.params.id, projectId: pid(req) });
  res.json({ success: true, message: 'Redirect deleted' });
});

export const importRedirects = asyncHandler(async (req: Request, res: Response) => {
  const project = await tenantOf(req);
  const rows = Array.isArray(req.body?.redirects) ? req.body.redirects.slice(0, 5000) : [];
  const summary = { created: 0, updated: 0, invalid: 0 };
  for (const row of rows) {
    try {
      const data = validateRedirect(row);
      const r = await Redirect.updateOne(
        { projectId: pid(req), from: data.from },
        { $set: { ...data, tenantId: project.tenantId } },
        { upsert: true }
      );
      if (r.upsertedCount) summary.created++; else summary.updated++;
    } catch {
      summary.invalid++;
    }
  }
  res.json({ success: true, data: summary });
});

export const listNotFound = asyncHandler(async (req: Request, res: Response) => {
  const logs = await NotFoundLog.find({ projectId: pid(req), resolved: { $ne: true } }).sort({ hits: -1 }).limit(500);
  res.json({ success: true, data: logs });
});

export const dismissNotFound = asyncHandler(async (req: Request, res: Response) => {
  await NotFoundLog.updateOne({ _id: req.params.id, projectId: pid(req) }, { resolved: true });
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// GEO score & structured data
// ---------------------------------------------------------------------------

export const geoForContent = asyncHandler(async (req: Request, res: Response) => {
  const content = await Content.findOne({ _id: req.params.contentId, projectId: pid(req), isDeleted: { $ne: true } });
  if (!content) throw new AppError('Content not found', 404);
  const { site } = await loadSeoContext(req.params.projectId);
  const geo = analyzeGeo(content.toObject(), site ? new URL(site).host : null);
  const bundle = await buildMetaBundle(req.params.projectId, content.toObject());
  res.json({ success: true, data: { ...geo, preview: bundle } });
});

export const geoOverview = asyncHandler(async (req: Request, res: Response) => {
  const { site, settings } = await loadSeoContext(req.params.projectId);
  const host = site ? new URL(site).host : null;
  const items = await Content.find({ projectId: pid(req), status: 'published', isDeleted: { $ne: true } })
    .sort({ updatedAt: -1 })
    .limit(300);
  const pages = items
    .filter((c) => contentPath(c.toObject() as any, settings))
    .map((c) => {
      const g = analyzeGeo(c.toObject(), host);
      return {
        contentId: c._id,
        name: c.name,
        type: c.contentTypeApiId || c.type,
        contentTypeId: c.contentTypeId,
        path: contentPath(c.toObject() as any, settings),
        score: g.score,
        grade: g.grade,
        topFix: g.recommendations[0],
      };
    })
    .sort((a, b) => a.score - b.score);
  const avg = pages.length ? Math.round(pages.reduce((n, p) => n + p.score, 0) / pages.length) : 0;
  const aiBlocked = [...(settings?.aiCrawlers?.entries() || [])].filter(([, v]) => v === 'block').map(([k]) => k);
  res.json({
    success: true,
    data: {
      averageScore: avg,
      pagesAnalyzed: pages.length,
      pages,
      readiness: {
        siteUrl: Boolean(site),
        llmsTxt: settings?.llms?.enabled !== false,
        organization: Boolean(settings?.organization?.name),
        aiCrawlersBlocked: aiBlocked,
        indexNow: Boolean(settings?.indexNow?.enabled),
      },
    },
  });
});

// ---------------------------------------------------------------------------
// PageSpeed / Core Web Vitals (Google PageSpeed Insights API)
// ---------------------------------------------------------------------------

export const pageSpeed = asyncHandler(async (req: Request, res: Response) => {
  const { site } = await loadSeoContext(req.params.projectId);
  const url = String(req.query.url || site || '');
  const strategy = req.query.strategy === 'desktop' ? 'desktop' : 'mobile';
  if (!/^https?:\/\//i.test(url)) throw new AppError('Set your site URL first, or pass a full URL', 400);
  if (site && new URL(url).host !== new URL(site).host) throw new AppError('URL must be on your site', 400);

  const params = new URLSearchParams({ url, strategy });
  ['PERFORMANCE', 'SEO', 'ACCESSIBILITY', 'BEST_PRACTICES'].forEach((c) => params.append('category', c));
  if (process.env.PAGESPEED_API_KEY) params.set('key', process.env.PAGESPEED_API_KEY);

  let data: any;
  try {
    data = (await axios.get(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { timeout: 90_000 })).data;
  } catch (err: any) {
    throw new AppError(`PageSpeed check failed: ${err.response?.data?.error?.message || err.message}`, 502);
  }
  const cats = data.lighthouseResult?.categories || {};
  const audits = data.lighthouseResult?.audits || {};
  const field = data.loadingExperience?.metrics || {};
  const score = (k: string) => (cats[k]?.score != null ? Math.round(cats[k].score * 100) : null);
  const lab = (k: string) => audits[k] ? { value: audits[k].displayValue, score: audits[k].score } : null;
  const fieldMetric = (k: string) => field[k] ? { percentile: field[k].percentile, category: field[k].category } : null;
  const opportunities = Object.values(audits)
    .filter((a: any) => a.details?.type === 'opportunity' && a.score !== null && a.score < 0.9)
    .sort((a: any, b: any) => (b.details?.overallSavingsMs || 0) - (a.details?.overallSavingsMs || 0))
    .slice(0, 8)
    .map((a: any) => ({ title: a.title, savings: a.displayValue, description: String(a.description || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') }));

  res.json({
    success: true,
    data: {
      url,
      strategy,
      scores: { performance: score('performance'), seo: score('seo'), accessibility: score('accessibility'), bestPractices: score('best-practices') },
      lab: {
        lcp: lab('largest-contentful-paint'),
        cls: lab('cumulative-layout-shift'),
        tbt: lab('total-blocking-time'),
        fcp: lab('first-contentful-paint'),
        speedIndex: lab('speed-index'),
      },
      field: {
        lcp: fieldMetric('LARGEST_CONTENTFUL_PAINT_MS'),
        inp: fieldMetric('INTERACTION_TO_NEXT_PAINT'),
        cls: fieldMetric('CUMULATIVE_LAYOUT_SHIFT_SCORE'),
        overall: data.loadingExperience?.overall_category || null,
      },
      opportunities,
    },
  });
});

// ---------------------------------------------------------------------------
// Keyword ranks (real SERP data)
// ---------------------------------------------------------------------------

export const checkRanks = asyncHandler(async (req: Request, res: Response) => {
  if (!rankProviderConfigured()) {
    throw new AppError('Rank tracking needs a SERP data provider. Ask your admin to set SERPER_API_KEY.', 501);
  }
  const { site } = await loadSeoContext(req.params.projectId);
  if (!site) throw new AppError('Set your site URL in SEO settings first', 400);
  const filter: any = { projectId: pid(req) };
  if (req.body?.keywordId && Types.ObjectId.isValid(req.body.keywordId)) filter._id = req.body.keywordId;
  const keywords = await KeywordRank.find(filter).limit(50);
  const results = [];
  for (const kw of keywords) {
    try {
      results.push({ keyword: kw.keyword, ...(await checkKeywordRank(kw, site, { gl: req.body?.country, hl: req.body?.language })) });
    } catch (err: any) {
      results.push({ keyword: kw.keyword, error: err.message });
    }
  }
  res.json({ success: true, data: results });
});

// ---------------------------------------------------------------------------
// Google Search Console
// ---------------------------------------------------------------------------

export const gscStatus = asyncHandler(async (req: Request, res: Response) => {
  const s = await SeoSettings.findOne({ projectId: pid(req) }).select('gsc').lean();
  res.json({ success: true, data: { configured: gsc.gscConfigured(), redirectUri: gsc.gscRedirectUri(), ...(s as any)?.gsc } });
});

export const gscConnectUrl = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: { url: gsc.connectUrl(req.params.projectId, String(req.user?._id)) } });
});

/** Public: Google redirects here (state carries the project). */
export const gscCallback = asyncHandler(async (req: Request, res: Response) => {
  const app = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  let projectId = '';
  try {
    const state = gsc.readState(String(req.query.state || ''));
    projectId = state.p;
    if (req.query.error) throw new AppError(String(req.query.error), 400);
    await gsc.completeConnection(projectId, String(req.query.code || ''));
    res.redirect(302, `${app}/dashboard/project/${projectId}/seo/search-console?connected=1`);
  } catch (err: any) {
    const target = projectId ? `${app}/dashboard/project/${projectId}/seo/search-console` : `${app}/dashboard`;
    res.redirect(302, `${target}?error=${encodeURIComponent(String(err.message || 'Connection failed').slice(0, 200))}`);
  }
});

export const gscSites = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await gsc.listSites(req.params.projectId) });
});

export const gscSelectSite = asyncHandler(async (req: Request, res: Response) => {
  const siteUrl = String(req.body?.siteUrl || '');
  const sites = await gsc.listSites(req.params.projectId);
  if (!sites.find((s: any) => s.siteUrl === siteUrl)) throw new AppError('That property is not available on the connected Google account', 400);
  await SeoSettings.updateOne({ projectId: pid(req) }, { $set: { 'gsc.siteUrl': siteUrl } });
  res.json({ success: true });
});

export const gscPerformance = asyncHandler(async (req: Request, res: Response) => {
  const days = Math.min(90, Math.max(7, parseInt(String(req.query.days || '28'), 10) || 28));
  res.json({ success: true, data: await gsc.performance(req.params.projectId, days) });
});

export const gscDisconnect = asyncHandler(async (req: Request, res: Response) => {
  await gsc.disconnect(pid(req));
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Content brief (AI) + live GEO scoring of a draft
// ---------------------------------------------------------------------------

export const contentBrief = asyncHandler(async (req: Request, res: Response) => {
  const keyword = String(req.body?.keyword || '').trim().slice(0, 200);
  if (!keyword) throw new AppError('Enter a keyword or topic', 400);
  const audience = String(req.body?.audience || '').slice(0, 300);
  const { settings } = await loadSeoContext(req.params.projectId);
  const prompt = `You are an SEO and GEO (AI search) content strategist. Create a content brief for the topic "${keyword}"${audience ? ` for this audience: ${audience}` : ''}${settings?.siteName ? ` on the website "${settings.siteName}"` : ''}.

Return ONLY JSON with this shape:
{
  "searchIntent": "informational | commercial | transactional | navigational",
  "titles": ["3 title options under 60 characters"],
  "metaDescription": "under 155 characters",
  "summary": "a 2-3 sentence direct answer to open the article with",
  "outline": [{ "heading": "H2 phrased as a question where natural", "points": ["what to cover"] }],
  "questions": ["6-10 questions people ask that the article must answer"],
  "entities": ["key terms, products, people or concepts to mention"],
  "statistics": ["kinds of numbers/data worth citing"],
  "wordCount": 1200,
  "faq": [{ "question": "...", "answer": "1-2 sentence answer" }]
}`;
  const raw = await aiGateway.chat(prompt, { maxTokens: 2500, temperature: 0.4 });
  const json = raw.match(/\{[\s\S]*\}/);
  if (!json) throw new AppError('The AI did not return a brief. Try again.', 502);
  try {
    res.json({ success: true, data: { keyword, ...JSON.parse(json[0]) } });
  } catch {
    throw new AppError('The AI returned an invalid brief. Try again.', 502);
  }
});

export const analyzeDraft = asyncHandler(async (req: Request, res: Response) => {
  const html = String(req.body?.html || '');
  if (!html.trim()) throw new AppError('Paste some content to analyse', 400);
  const { site } = await loadSeoContext(req.params.projectId);
  const geo = analyzeGeo({
    type: req.body?.type || 'blog',
    name: String(req.body?.title || 'Draft'),
    updatedAt: new Date(),
    seo: { metaTitle: req.body?.title, metaDescription: req.body?.metaDescription },
    data: { title: req.body?.title, content: html.slice(0, 200_000), author: req.body?.author },
  }, site ? new URL(site).host : null);
  res.json({ success: true, data: geo });
});
