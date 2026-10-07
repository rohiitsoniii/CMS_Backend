import axios from 'axios';
import { Types } from 'mongoose';
import { SeoSettings, ISeoSettings } from '../models/SeoSettings.js';
import { Project } from '../models/index.js';

/**
 * URL building + IndexNow pings (Bing, Yandex, Seznam, Naver... share pings).
 */

export function normalizeSiteUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export async function siteUrlFor(projectId: Types.ObjectId | string, settings?: ISeoSettings | null): Promise<string | null> {
  if (settings?.siteUrl) return normalizeSiteUrl(settings.siteUrl);
  const project = await Project.findById(projectId).select('domain').lean();
  return normalizeSiteUrl((project as any)?.domain);
}

/** Public path for a content entry, or null when it has no public URL. */
export function contentPath(
  content: { slug?: string; type?: string; contentTypeApiId?: string; locale?: string },
  settings?: Pick<ISeoSettings, 'urlPatterns' | 'defaultPattern'> | null
): string | null {
  if (!content.slug) return null;
  const typeKey = content.contentTypeApiId || content.type || '';
  const match = settings?.urlPatterns?.find((p) => p.contentType === typeKey || p.contentType === content.type);
  let pattern = match?.pattern;
  if (!pattern) {
    if (settings) pattern = settings.defaultPattern;
    else pattern = content.type === 'blog' ? '/blog/{slug}' : ['page', 'custom'].includes(content.type || '') || content.contentTypeApiId ? '/{slug}' : '';
  }
  if (!pattern) return null;
  const path = pattern
    .replace('{slug}', encodeURIComponent(content.slug))
    .replace('{type}', encodeURIComponent(typeKey))
    .replace('{locale}', encodeURIComponent(content.locale || 'en'));
  return path.startsWith('/') ? path : `/${path}`;
}

export const seoPingService = {
  async contentPublished(content: { projectId?: any; slug?: string; type?: string; contentTypeApiId?: string }) {
    if (!content.projectId) return;
    const settings = await SeoSettings.findOne({ projectId: content.projectId });
    if (!settings?.indexNow?.enabled || !settings.indexNow.key) return;
    const site = await siteUrlFor(content.projectId, settings);
    const path = contentPath(content, settings);
    if (!site || !path) return;
    await this.ping(settings, site, [`${site}${path}`]);
  },

  async ping(settings: ISeoSettings, site: string, urls: string[]) {
    const host = new URL(site).host;
    try {
      await axios.post(
        'https://api.indexnow.org/indexnow',
        { host, key: settings.indexNow.key, keyLocation: `${site}/${settings.indexNow.key}.txt`, urlList: urls.slice(0, 10_000) },
        { headers: { 'Content-Type': 'application/json; charset=utf-8' }, timeout: 15_000 }
      );
      settings.indexNow.lastPingAt = new Date();
      settings.indexNow.lastError = undefined;
    } catch (err: any) {
      settings.indexNow.lastError = `IndexNow ${err.response?.status || ''} ${err.message}`.trim().slice(0, 300);
    }
    await settings.save();
  },
};
