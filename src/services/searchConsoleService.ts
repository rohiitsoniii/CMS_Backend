import crypto from 'crypto';
import { Types } from 'mongoose';
import { SeoSettings } from '../models/SeoSettings.js';
import { encrypt, decrypt } from './cryptoService.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Google Search Console: real clicks, impressions, CTR and positions.
 * Uses the Google OAuth app (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET); add
 * <PUBLIC_API_URL>/api/v1/seo/gsc/callback as an authorised redirect URI.
 */

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly openid email';
const apiBase = () => (process.env.PUBLIC_API_URL || `http://localhost:${config.port}`).replace(/\/+$/, '');
export const gscRedirectUri = () => `${apiBase()}/api/v1/seo/gsc/callback`;
export const gscConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const sign = (s: string) => crypto.createHmac('sha256', config.jwt.secret).update(`gsc:${s}`).digest('base64url');

export function connectUrl(projectId: string, userId: string): string {
  if (!gscConfigured()) throw new AppError('Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).', 400);
  const body = Buffer.from(JSON.stringify({ p: projectId, u: userId, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: gscRedirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: `${body}.${sign(body)}`,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function readState(state: string): { p: string; u: string } {
  const [body, sig] = String(state || '').split('.');
  const expected = body ? sign(body) : '';
  if (!body || !sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new AppError('Invalid state', 400);
  }
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (data.exp < Date.now()) throw new AppError('Connection link expired, please try again', 400);
  return data;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(`Google token error: ${data.error_description || data.error || res.status}`, 502);
  return data;
}

export async function completeConnection(projectId: string, code: string) {
  const tokens = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: gscRedirectUri() });
  if (!tokens.refresh_token) throw new AppError('Google did not return offline access. Remove the app from your Google account and connect again.', 400);
  let email: string | undefined;
  try {
    const info: any = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } })).json();
    email = info.email;
  } catch { /* optional */ }
  const settings = await SeoSettings.findOne({ projectId });
  if (!settings) throw new AppError('Open SEO settings once before connecting Search Console', 400);
  (settings as any).gsc = { connected: true, email, refreshToken: encrypt(tokens.refresh_token), connectedAt: new Date(), siteUrl: (settings as any).gsc?.siteUrl };
  settings.markModified('gsc');
  await settings.save();
  accessCache.set(projectId, { token: tokens.access_token, until: Date.now() + (tokens.expires_in - 60) * 1000 });
}

const accessCache = new Map<string, { token: string; until: number }>();

async function accessToken(projectId: string): Promise<{ token: string; siteUrl?: string }> {
  const settings = await SeoSettings.findOne({ projectId }).select('+gsc.refreshToken gsc').lean() as any;
  if (!settings?.gsc?.connected || !settings.gsc.refreshToken) throw new AppError('Search Console is not connected', 400);
  const cached = accessCache.get(projectId);
  if (cached && cached.until > Date.now()) return { token: cached.token, siteUrl: settings.gsc.siteUrl };
  const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(settings.gsc.refreshToken) });
  accessCache.set(projectId, { token: tokens.access_token, until: Date.now() + (tokens.expires_in - 60) * 1000 });
  return { token: tokens.access_token, siteUrl: settings.gsc.siteUrl };
}

async function gscFetch(projectId: string, path: string, body?: unknown) {
  const { token } = await accessToken(projectId);
  const res = await fetch(`https://www.googleapis.com/webmasters/v3${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(`Search Console: ${data.error?.message || res.status}`, res.status === 403 ? 403 : 502);
  return data;
}

export async function listSites(projectId: string) {
  const data = await gscFetch(projectId, '/sites');
  return (data.siteEntry || []).map((s: any) => ({ siteUrl: s.siteUrl, permission: s.permissionLevel }));
}

export async function disconnect(projectId: string | Types.ObjectId) {
  await SeoSettings.updateOne({ projectId }, { $unset: { gsc: 1 } });
  accessCache.delete(String(projectId));
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function query(projectId: string, siteUrl: string, start: Date, end: Date, dimensions: string[], rowLimit = 250) {
  const data = await gscFetch(projectId, `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    startDate: ymd(start), endDate: ymd(end), dimensions, rowLimit, dataState: 'final',
  });
  return (data.rows || []).map((r: any) => ({
    key: r.keys?.[0], clicks: r.clicks, impressions: r.impressions,
    ctr: Math.round(r.ctr * 1000) / 10, position: Math.round(r.position * 10) / 10,
  }));
}

/** Overview for the last N days vs the previous N days. */
export async function performance(projectId: string, days = 28) {
  const { siteUrl } = await accessToken(projectId);
  if (!siteUrl) throw new AppError('Choose a Search Console property first', 400);
  // GSC data lags ~2 days
  const end = new Date(Date.now() - 2 * 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);

  const [series, queries, pages, prevPages, countries, devices] = await Promise.all([
    query(projectId, siteUrl, start, end, ['date'], 500),
    query(projectId, siteUrl, start, end, ['query'], 100),
    query(projectId, siteUrl, start, end, ['page'], 250),
    query(projectId, siteUrl, prevStart, prevEnd, ['page'], 250),
    query(projectId, siteUrl, start, end, ['country'], 10),
    query(projectId, siteUrl, start, end, ['device'], 5),
  ]);

  const sum = (rows: any[], k: 'clicks' | 'impressions') => rows.reduce((n, r) => n + r[k], 0);
  const clicks = sum(series, 'clicks');
  const impressions = sum(series, 'impressions');
  const avgPos = series.length ? Math.round((series.reduce((n: number, r: any) => n + r.position * r.impressions, 0) / Math.max(1, impressions)) * 10) / 10 : 0;

  const prevByPage = new Map(prevPages.map((r: any) => [r.key, r]));
  const losing = pages
    .map((p: any) => ({ ...p, prevClicks: (prevByPage.get(p.key) as any)?.clicks || 0 }))
    .concat(prevPages.filter((p: any) => !pages.find((c: any) => c.key === p.key)).map((p: any) => ({ key: p.key, clicks: 0, impressions: 0, ctr: 0, position: 0, prevClicks: p.clicks })))
    .map((p: any) => ({ ...p, change: p.clicks - p.prevClicks }))
    .filter((p: any) => p.change < 0 && p.prevClicks >= 5)
    .sort((a: any, b: any) => a.change - b.change)
    .slice(0, 15);

  // Quick wins: page-2 queries with impressions
  const opportunities = queries.filter((q: any) => q.position > 8 && q.position <= 20 && q.impressions >= 20).slice(0, 15);

  return {
    siteUrl,
    range: { start: ymd(start), end: ymd(end) },
    totals: { clicks, impressions, ctr: impressions ? Math.round((clicks / impressions) * 1000) / 10 : 0, position: avgPos },
    series: series.map((r: any) => ({ date: r.key, clicks: r.clicks, impressions: r.impressions })),
    queries,
    pages: pages.slice(0, 50),
    losing,
    opportunities,
    countries,
    devices,
  };
}
