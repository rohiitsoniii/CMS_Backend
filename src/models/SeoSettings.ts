import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Per-project SEO + GEO (generative engine optimisation) settings.
 */

/** AI crawlers a site owner may want to allow or block. */
export const AI_CRAWLERS = {
  GPTBot: 'OpenAI — training data for ChatGPT models',
  'OAI-SearchBot': 'OpenAI — ChatGPT search results (citations)',
  'ChatGPT-User': 'OpenAI — pages fetched when a ChatGPT user asks',
  ClaudeBot: 'Anthropic — training data for Claude models',
  'Claude-SearchBot': 'Anthropic — Claude search results (citations)',
  'Claude-User': 'Anthropic — pages fetched when a Claude user asks',
  PerplexityBot: 'Perplexity — answer engine index (citations)',
  'Google-Extended': 'Google — Gemini training (does not affect Google Search)',
  'Applebot-Extended': 'Apple — Apple Intelligence training',
  CCBot: 'Common Crawl — open dataset used by many AI models',
  'meta-externalagent': 'Meta — AI training',
  Bytespider: 'ByteDance — AI training',
} as const;

export type AICrawler = keyof typeof AI_CRAWLERS;

export interface IUrlPattern {
  contentType: string; // ContentType apiId or legacy type (blog, page...)
  pattern: string; // e.g. /blog/{slug}
  includeInSitemap: boolean;
  changefreq?: string;
  priority?: number;
}

export interface ISeoSettings extends Document {
  projectId: Types.ObjectId;
  tenantId: Types.ObjectId;

  siteUrl?: string;
  siteName?: string;
  titleTemplate?: string; // "%s | Acme"
  defaultDescription?: string;
  defaultOgImage?: string;
  twitterHandle?: string;
  defaultLocale?: string;

  urlPatterns: IUrlPattern[];
  defaultPattern: string; // used when no pattern matches; '' = exclude

  verification: { google?: string; bing?: string; yandex?: string };

  organization: {
    type: 'Organization' | 'LocalBusiness' | 'Person';
    name?: string;
    logo?: string;
    email?: string;
    phone?: string;
    address?: string;
    sameAs: string[];
  };

  indexNow: { enabled: boolean; key?: string; lastPingAt?: Date; lastError?: string };

  aiCrawlers: Map<string, 'allow' | 'block'>;

  llms: {
    enabled: boolean;
    summary?: string; // blockquote summary in llms.txt
    details?: string; // free-form notes section
    contentTypes: string[]; // which types to list ([] = all with a URL)
    includeFullText: boolean; // serve llms-full.txt
  };

  gsc?: {
    connected: boolean;
    email?: string;
    siteUrl?: string;
    /** encrypted */
    refreshToken?: string;
    connectedAt?: Date;
  };

  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SeoSettingsSchema = new Schema<ISeoSettings>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    siteUrl: { type: String, trim: true, maxlength: 300 },
    siteName: { type: String, trim: true, maxlength: 150 },
    titleTemplate: { type: String, trim: true, maxlength: 150, default: '%s' },
    defaultDescription: { type: String, trim: true, maxlength: 320 },
    defaultOgImage: { type: String, trim: true, maxlength: 500 },
    twitterHandle: { type: String, trim: true, maxlength: 50 },
    defaultLocale: { type: String, trim: true, maxlength: 20, default: 'en' },
    urlPatterns: [
      {
        _id: false,
        contentType: { type: String, required: true, trim: true },
        pattern: { type: String, required: true, trim: true, maxlength: 200 },
        includeInSitemap: { type: Boolean, default: true },
        changefreq: { type: String, enum: ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'], default: 'weekly' },
        priority: { type: Number, min: 0, max: 1, default: 0.6 },
      },
    ],
    defaultPattern: { type: String, trim: true, default: '/{slug}' },
    verification: {
      google: { type: String, trim: true, maxlength: 200 },
      bing: { type: String, trim: true, maxlength: 200 },
      yandex: { type: String, trim: true, maxlength: 200 },
    },
    organization: {
      type: { type: String, enum: ['Organization', 'LocalBusiness', 'Person'], default: 'Organization' },
      name: { type: String, trim: true, maxlength: 200 },
      logo: { type: String, trim: true, maxlength: 500 },
      email: { type: String, trim: true, maxlength: 200 },
      phone: { type: String, trim: true, maxlength: 50 },
      address: { type: String, trim: true, maxlength: 500 },
      sameAs: { type: [String], default: [] },
    },
    indexNow: {
      enabled: { type: Boolean, default: false },
      key: { type: String, trim: true },
      lastPingAt: Date,
      lastError: String,
    },
    aiCrawlers: { type: Map, of: { type: String, enum: ['allow', 'block'] }, default: {} },
    llms: {
      enabled: { type: Boolean, default: true },
      summary: { type: String, trim: true, maxlength: 1000 },
      details: { type: String, trim: true, maxlength: 5000 },
      contentTypes: { type: [String], default: [] },
      includeFullText: { type: Boolean, default: true },
    },
    gsc: {
      connected: { type: Boolean, default: false },
      email: String,
      siteUrl: String,
      refreshToken: { type: String, select: false },
      connectedAt: Date,
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const SeoSettings = mongoose.model<ISeoSettings>('SeoSettings', SeoSettingsSchema);
