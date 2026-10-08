import { Project } from '../models/index.js';
import { SeoSettings } from '../models/SeoSettings.js';
import { normalizeSiteUrl } from './seoPingService.js';

/**
 * Account links in emails to a project's *website users* must point at the
 * customer's site, not the CMS dashboard. Resolution order:
 *   1. project.settings.endUserUrls.{verifyEmail|resetPassword}
 *   2. <SEO site URL or project domain>/{verify-email|reset-password}
 *   3. FRONTEND_URL (legacy behaviour)
 */
export async function endUserLink(projectId: unknown, kind: 'verifyEmail' | 'resetPassword', token: string): Promise<string> {
  const project = projectId ? await Project.findById(projectId).select('settings domain').lean() as any : null;
  const custom: string | undefined = project?.settings?.endUserUrls?.[kind];
  const enc = encodeURIComponent(token);
  if (custom && /^https?:\/\//.test(custom)) {
    return custom.includes('{token}') ? custom.replace('{token}', enc) : `${custom}${custom.includes('?') ? '&' : '?'}token=${enc}`;
  }
  const seo = projectId ? await SeoSettings.findOne({ projectId }).select('siteUrl').lean() : null;
  const site = normalizeSiteUrl((seo as any)?.siteUrl || project?.domain) || (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  const path = kind === 'verifyEmail' ? 'verify-email' : 'reset-password';
  return `${site}/${path}?token=${enc}`;
}
