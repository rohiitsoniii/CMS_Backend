import * as cheerio from 'cheerio';
import { Types } from 'mongoose';
import { Content, Project } from '../models/index.js';
import { RobotsConfig } from '../models/RobotsConfig.js';
import { SeoSettings, ISeoSettings, AI_CRAWLERS } from '../models/SeoSettings.js';
import { contentPath, siteUrlFor } from './seoPingService.js';
import { contentToText } from './ragIngestionService.js';

/**
 * GEO (Generative Engine Optimisation) + technical SEO outputs:
 *  - per-page GEO score with actionable recommendations
 *  - JSON-LD structured data
 *  - llms.txt / llms-full.txt
 *  - robots.txt with AI crawler policy
 *  - complete meta-tag bundle for headless frontends
 */

// ---------------------------------------------------------------------------
// Field helpers (content data is schema-less)
// ---------------------------------------------------------------------------

const FIELD_ALIASES = {
  title: ['title', 'headline', 'name', 'heading'],
  description: ['excerpt', 'description', 'summary', 'subtitle', 'intro'],
  body: ['content', 'body', 'html', 'text', 'richText', 'article'],
  image: ['featuredImage', 'coverImage', 'image', 'heroImage', 'ogImage', 'thumbnail'],
  author: ['author', 'authorName', 'writer'],
};

function pick(data: any, keys: string[]): any {
  if (!data || typeof data !== 'object') return undefined;
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && data[k] !== '') return data[k];
  }
  return undefined;
}

const asText = (v: any): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return cheerio.load(v).text().replace(/\s+/g, ' ').trim() || undefined;
  if (typeof v === 'object' && (v.name || v.title)) return String(v.name || v.title);
  return undefined;
};

const asImage = (v: any): string | undefined => {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.url || v.src || undefined;
  return undefined;
};

/** Concatenate every HTML-ish string field to analyse page structure. */
function collectHtml(data: any, depth = 0): string {
  if (depth > 6 || data === null || data === undefined) return '';
  if (typeof data === 'string') return /<[a-z][\s\S]*>/i.test(data) ? data : `<p>${data}</p>`;
  if (Array.isArray(data)) return data.map((d) => collectHtml(d, depth + 1)).join('\n');
  if (typeof data === 'object') return Object.values(data).map((d) => collectHtml(d, depth + 1)).join('\n');
  return '';
}

export function describeContent(content: any) {
  const data = content.data || {};
  return {
    title: content.seo?.metaTitle || asText(pick(data, FIELD_ALIASES.title)) || content.name,
    headline: asText(pick(data, FIELD_ALIASES.title)) || content.name,
    description: content.seo?.metaDescription || asText(pick(data, FIELD_ALIASES.description)),
    image: content.seo?.ogImage?.url || asImage(pick(data, FIELD_ALIASES.image)),
    author: asText(pick(data, FIELD_ALIASES.author)),
    publishedAt: content.meta?.publishedAt || content.publishedAt || content.createdAt,
    updatedAt: content.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// GEO score
// ---------------------------------------------------------------------------

export interface GeoCheck {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
  detail: string;
  fix?: string;
}

const QUESTION_RE = /^(what|how|why|when|where|who|which|can|does|do|is|are|should|will)\b|\?\s*$/i;

export function analyzeGeo(content: any, siteHost?: string | null) {
  const html = collectHtml(content.data);
  const $ = cheerio.load(html);
  const text = contentToText(content);
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const meta = describeContent(content);

  const headings = $('h2, h3').map((_, el) => $(el).text().trim()).get();
  const questionHeadings = headings.filter((h) => QUESTION_RE.test(h));
  const paragraphs = $('p').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const firstPara = paragraphs[0] || words.slice(0, 80).join(' ');
  const firstParaWords = firstPara.split(/\s+/).filter(Boolean).length;
  const lists = $('ul, ol').length;
  const tables = $('table').length;
  const stats = (text.match(/\b\d+(?:[.,]\d+)?\s?(%|percent|x\b|times|million|billion|k\b|users|customers|hours|days|years)/gi) || []).length
    + (text.match(/[$€£₹]\s?\d/g) || []).length;
  const links = $('a[href]').map((_, el) => $(el).attr('href') || '').get();
  const outbound = links.filter((h) => /^https?:\/\//i.test(h) && (!siteHost || !h.includes(siteHost)));
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().split(/\s+/).length > 3);
  const avgSentence = sentences.length ? Math.round(wordCount / sentences.length) : 0;
  const hasFaq = /\bfaq|frequently asked/i.test(headings.join(' ')) || questionHeadings.length >= 3 || content.type === 'faq';
  const ageDays = content.updatedAt ? (Date.now() - new Date(content.updatedAt).getTime()) / 86_400_000 : 9999;
  const isShortForm = ['header', 'footer', 'hero', 'banner', 'popup', 'navigation', 'cta'].includes(content.type);

  const checks: GeoCheck[] = [
    {
      id: 'answer_first', label: 'Answer-first introduction', weight: 15,
      passed: firstParaWords >= 15 && firstParaWords <= 90,
      detail: `Opening paragraph has ${firstParaWords} words.`,
      fix: 'Start with a 1–3 sentence direct answer or summary (15–90 words). AI engines quote opening summaries most often.',
    },
    {
      id: 'question_headings', label: 'Question-style headings', weight: 10,
      passed: questionHeadings.length >= 2,
      detail: `${questionHeadings.length} of ${headings.length} H2/H3 headings are phrased as questions.`,
      fix: 'Phrase key H2/H3 headings as the questions people ask (e.g. "How much does X cost?").',
    },
    {
      id: 'structure', label: 'Lists or tables', weight: 10,
      passed: lists + tables >= 1,
      detail: `${lists} lists, ${tables} tables.`,
      fix: 'Add a bulleted list, numbered steps or a comparison table — structured content is easier for AI to extract.',
    },
    {
      id: 'statistics', label: 'Specific facts & statistics', weight: 12,
      passed: stats >= 3,
      detail: `${stats} numbers/statistics found.`,
      fix: 'Include concrete numbers (prices, percentages, durations, counts). Pages with statistics are cited more by AI answers.',
    },
    {
      id: 'citations', label: 'Cites external sources', weight: 10,
      passed: outbound.length >= 2,
      detail: `${outbound.length} outbound links.`,
      fix: 'Link to 2+ authoritative sources (studies, docs, official sites) to back up claims.',
    },
    {
      id: 'faq', label: 'FAQ section', weight: 8,
      passed: hasFaq,
      detail: hasFaq ? 'FAQ-style content detected.' : 'No FAQ section detected.',
      fix: 'Add a short FAQ section (3–5 questions). It also enables FAQPage structured data.',
    },
    {
      id: 'depth', label: 'Sufficient depth', weight: 10,
      passed: isShortForm || wordCount >= 300,
      detail: `${wordCount} words.`,
      fix: 'Expand to at least 300 words covering the topic completely.',
    },
    {
      id: 'readability', label: 'Readable sentences', weight: 7,
      passed: avgSentence > 0 && avgSentence <= 25,
      detail: `Average sentence length ${avgSentence} words.`,
      fix: 'Keep sentences under ~25 words; split long ones.',
    },
    {
      id: 'freshness', label: 'Recently updated', weight: 8,
      passed: ageDays <= 365,
      detail: ageDays < 9999 ? `Last updated ${Math.round(ageDays)} days ago.` : 'Unknown update date.',
      fix: 'Review and update this page at least yearly; AI engines prefer fresh content.',
    },
    {
      id: 'metadata', label: 'Title & meta description', weight: 5,
      passed: Boolean(content.seo?.metaTitle || meta.title) && Boolean(meta.description),
      detail: meta.description ? 'Description present.' : 'Missing meta description.',
      fix: 'Write a meta description (120–160 chars) summarising the page.',
    },
    {
      id: 'authorship', label: 'Author & date (E-E-A-T)', weight: 5,
      passed: Boolean(meta.author) || ['page', 'faq'].includes(content.type),
      detail: meta.author ? `Author: ${meta.author}` : 'No author field.',
      fix: 'Show an author with credentials and a published/updated date to build trust.',
    },
  ];

  const total = checks.reduce((n, c) => n + c.weight, 0);
  const score = Math.round((checks.filter((c) => c.passed).reduce((n, c) => n + c.weight, 0) / total) * 100);
  return {
    score,
    grade: score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F',
    wordCount,
    checks,
    recommendations: checks.filter((c) => !c.passed).sort((a, b) => b.weight - a.weight).map((c) => c.fix!),
  };
}

// ---------------------------------------------------------------------------
// Structured data (JSON-LD)
// ---------------------------------------------------------------------------

function extractFaq(content: any): Array<{ q: string; a: string }> {
  const data = content.data || {};
  const out: Array<{ q: string; a: string }> = [];
  // Explicit FAQ shapes: items/faqs/questions arrays or categories[].items
  const lists = [data.items, data.faqs, data.questions, ...(Array.isArray(data.categories) ? data.categories.map((c: any) => c?.items) : [])];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const it of list) {
      const q = asText(it?.question || it?.q || it?.title);
      const a = asText(it?.answer || it?.a || it?.content);
      if (q && a) out.push({ q, a });
    }
  }
  if (out.length) return out.slice(0, 30);
  // Derive from question headings followed by text
  const $ = cheerio.load(collectHtml(data));
  $('h2, h3').each((_, el) => {
    const q = $(el).text().trim();
    if (!QUESTION_RE.test(q)) return;
    const a = $(el).nextUntil('h2, h3').text().replace(/\s+/g, ' ').trim();
    if (a) out.push({ q, a: a.slice(0, 1000) });
  });
  return out.slice(0, 30);
}

export function organizationSchema(settings: ISeoSettings | null, site: string | null, projectName: string) {
  const org = settings?.organization;
  return {
    '@type': org?.type || 'Organization',
    '@id': site ? `${site}/#organization` : undefined,
    name: org?.name || settings?.siteName || projectName,
    url: site || undefined,
    logo: org?.logo || undefined,
    email: org?.email || undefined,
    telephone: org?.phone || undefined,
    address: org?.address || undefined,
    sameAs: org?.sameAs?.length ? org.sameAs : undefined,
  };
}

export function buildJsonLd(content: any, opts: { site: string | null; path: string | null; settings: ISeoSettings | null; projectName: string }) {
  const { site, path, settings, projectName } = opts;
  const url = site && path ? `${site}${path}` : undefined;
  const m = describeContent(content);
  const graph: any[] = [];
  const org = organizationSchema(settings, site, projectName);

  const isArticle = content.type === 'blog' || /post|article|blog|news/i.test(content.contentTypeApiId || '');
  graph.push({
    '@type': isArticle ? 'BlogPosting' : 'WebPage',
    '@id': url ? `${url}#main` : undefined,
    url,
    [isArticle ? 'headline' : 'name']: m.headline,
    description: m.description,
    image: m.image ? [m.image] : undefined,
    datePublished: m.publishedAt ? new Date(m.publishedAt).toISOString() : undefined,
    dateModified: m.updatedAt ? new Date(m.updatedAt).toISOString() : undefined,
    author: isArticle ? (m.author ? { '@type': 'Person', name: m.author } : { '@id': org['@id'], '@type': org['@type'], name: org.name }) : undefined,
    publisher: isArticle ? { '@type': 'Organization', name: org.name, logo: org.logo ? { '@type': 'ImageObject', url: org.logo } : undefined } : undefined,
    mainEntityOfPage: url,
    inLanguage: content.locale || settings?.defaultLocale || undefined,
  });

  const faq = extractFaq(content);
  if (faq.length >= 2) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    });
  }

  if (site && path && path !== '/') {
    const segments = path.split('/').filter(Boolean);
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: settings?.siteName || projectName, item: `${site}/` },
        ...segments.map((seg, i) => ({
          '@type': 'ListItem',
          position: i + 2,
          name: i === segments.length - 1 ? m.headline : decodeURIComponent(seg).replace(/[-_]/g, ' '),
          item: `${site}/${segments.slice(0, i + 1).join('/')}`,
        })),
      ],
    });
  }

  return { '@context': 'https://schema.org', '@graph': JSON.parse(JSON.stringify(graph)) };
}

// ---------------------------------------------------------------------------
// Settings loader
// ---------------------------------------------------------------------------

export async function loadSeoContext(projectId: Types.ObjectId | string) {
  const [settings, project] = await Promise.all([
    SeoSettings.findOne({ projectId }),
    Project.findById(projectId).select('name domain tenantId status').lean(),
  ]);
  const site = await siteUrlFor(projectId, settings);
  return { settings, project: project as any, site };
}

const publishedFilter = (projectId: any) => ({ projectId, status: 'published', isDeleted: { $ne: true } });

// ---------------------------------------------------------------------------
// Meta bundle for headless frontends
// ---------------------------------------------------------------------------

export async function buildMetaBundle(projectId: string, content: any) {
  const { settings, project, site } = await loadSeoContext(projectId);
  const path = contentPath(content, settings);
  const m = describeContent(content);
  const titleTemplate = settings?.titleTemplate || '%s';
  const title = titleTemplate.includes('%s') ? titleTemplate.replace('%s', m.title) : `${m.title} ${titleTemplate}`.trim();
  const canonical = content.seo?.canonicalUrl || (site && path ? `${site}${path}` : undefined);
  const description = m.description || settings?.defaultDescription;
  const image = m.image || settings?.defaultOgImage;
  const isArticle = content.type === 'blog' || /post|article|blog|news/i.test(content.contentTypeApiId || '');

  const tags: Array<{ name?: string; property?: string; content: string }> = [];
  const add = (key: 'name' | 'property', k: string, v?: string) => { if (v) tags.push({ [key]: k, content: v } as any); };
  add('name', 'description', description);
  add('name', 'robots', [content.seo?.noIndex ? 'noindex' : 'index', content.seo?.noFollow ? 'nofollow' : 'follow', 'max-image-preview:large'].join(', '));
  add('property', 'og:type', isArticle ? 'article' : 'website');
  add('property', 'og:title', m.title);
  add('property', 'og:description', description);
  add('property', 'og:url', canonical);
  add('property', 'og:image', image);
  add('property', 'og:site_name', settings?.siteName || project?.name);
  add('property', 'og:locale', content.locale || settings?.defaultLocale);
  if (isArticle) {
    add('property', 'article:published_time', m.publishedAt ? new Date(m.publishedAt).toISOString() : undefined);
    add('property', 'article:modified_time', m.updatedAt ? new Date(m.updatedAt).toISOString() : undefined);
  }
  add('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
  add('name', 'twitter:title', m.title);
  add('name', 'twitter:description', description);
  add('name', 'twitter:image', image);
  add('name', 'twitter:site', settings?.twitterHandle);
  add('name', 'google-site-verification', settings?.verification?.google);
  add('name', 'msvalidate.01', settings?.verification?.bing);
  add('name', 'yandex-verification', settings?.verification?.yandex);

  // hreflang alternates for localized entries
  const alternates: Array<{ hreflang: string; href: string }> = [];
  if (site && path && content.localizedData && typeof content.localizedData === 'object') {
    const locales = Object.keys(content.localizedData instanceof Map ? Object.fromEntries(content.localizedData) : content.localizedData);
    const pattern = settings?.urlPatterns?.find((p) => p.contentType === (content.contentTypeApiId || content.type))?.pattern || '';
    if (pattern.includes('{locale}')) {
      for (const loc of locales) alternates.push({ hreflang: loc, href: `${site}${contentPath({ ...content, locale: loc }, settings)}` });
      alternates.push({ hreflang: 'x-default', href: canonical! });
    }
  }

  return {
    title,
    description,
    canonical,
    path,
    meta: tags,
    alternates,
    jsonLd: buildJsonLd(content, { site, path, settings, projectName: project?.name || '' }),
  };
}

// ---------------------------------------------------------------------------
// robots.txt, sitemap.xml, llms.txt
// ---------------------------------------------------------------------------

export async function buildRobotsTxt(projectId: string) {
  const { settings, site } = await loadSeoContext(projectId);
  const base = await RobotsConfig.findOne({ projectId }).lean();
  let out = (base?.content || 'User-agent: *\nAllow: /').replace(/^Sitemap:.*$/gim, '').trim();

  const blocked: string[] = [];
  const allowed: string[] = [];
  settings?.aiCrawlers?.forEach((policy, bot) => {
    if (!(bot in AI_CRAWLERS)) return;
    (policy === 'block' ? blocked : allowed).push(bot);
  });
  if (blocked.length || allowed.length) {
    out += '\n\n# AI crawlers';
    for (const bot of blocked) out += `\nUser-agent: ${bot}\nDisallow: /\n`;
    for (const bot of allowed) out += `\nUser-agent: ${bot}\nAllow: /\n`;
  }
  if (site) out += `\n\nSitemap: ${site}/sitemap.xml`;
  return `${out.trim()}\n`;
}

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));

export async function buildSitemapXml(projectId: string) {
  const { settings, site } = await loadSeoContext(projectId);
  const base = site || 'https://example.com';
  const items = await Content.find({ ...publishedFilter(projectId), 'seo.noIndex': { $ne: true } })
    .select('slug type contentTypeApiId updatedAt locale')
    .limit(50_000)
    .lean();

  const urls: string[] = [`  <url><loc>${xmlEscape(base)}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`];
  const seen = new Set<string>(['/']);
  for (const c of items) {
    const pattern = settings?.urlPatterns?.find((p) => p.contentType === (c.contentTypeApiId || c.type));
    if (pattern && pattern.includeInSitemap === false) continue;
    const path = contentPath(c as any, settings);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    urls.push(
      `  <url><loc>${xmlEscape(base + path)}</loc><lastmod>${new Date(c.updatedAt as any).toISOString()}</lastmod>` +
      `<changefreq>${pattern?.changefreq || 'weekly'}</changefreq><priority>${(pattern?.priority ?? 0.6).toFixed(1)}</priority></url>`
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export async function buildLlmsTxt(projectId: string, full = false) {
  const { settings, project, site } = await loadSeoContext(projectId);
  if (settings && settings.llms?.enabled === false) return null;
  if (full && settings?.llms?.includeFullText === false) return null;

  const filter: any = { ...publishedFilter(projectId), 'seo.noIndex': { $ne: true } };
  if (settings?.llms?.contentTypes?.length) {
    filter.$or = [{ contentTypeApiId: { $in: settings.llms.contentTypes } }, { type: { $in: settings.llms.contentTypes } }];
  }
  const items = await Content.find(filter).sort({ updatedAt: -1 }).limit(full ? 500 : 2000).lean();

  const name = settings?.siteName || project?.name || 'Website';
  const lines: string[] = [`# ${name}`, ''];
  const summary = settings?.llms?.summary || settings?.defaultDescription;
  if (summary) lines.push(`> ${summary.replace(/\n+/g, ' ')}`, '');
  if (settings?.llms?.details) lines.push(settings.llms.details, '');

  const groups = new Map<string, any[]>();
  for (const c of items) {
    const path = contentPath(c as any, settings);
    if (!path) continue;
    const key = c.contentTypeApiId || c.type || 'Pages';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ ...c, _path: path });
  }

  for (const [group, list] of groups) {
    lines.push(`## ${group.charAt(0).toUpperCase()}${group.slice(1).replace(/([a-z])([A-Z])/g, '$1 $2')}`, '');
    for (const c of list) {
      const m = describeContent(c);
      const url = site ? `${site}${c._path}` : c._path;
      if (full) {
        lines.push(`### ${m.headline}`, '', `URL: ${url}`, m.updatedAt ? `Updated: ${new Date(m.updatedAt).toISOString().slice(0, 10)}` : '', '', contentToText(c).slice(0, 20_000), '');
      } else {
        lines.push(`- [${m.headline}](${url})${m.description ? `: ${m.description.slice(0, 200)}` : ''}`);
      }
    }
    lines.push('');
  }
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim() + '\n';
}
