import nodemailer, { Transporter } from 'nodemailer';
import { Types } from 'mongoose';
import { SMTPConfig, ISMTPConfig } from '../models/SMTPConfig.js';
import { Project, Tenant } from '../models/index.js';
import { decrypt } from './cryptoService.js';

/**
 * Mailer Service — the single place that sends email.
 *
 * Resolution order for a project:
 *   1. Project has an active, custom (BYO) SMTP config → send through it.
 *   2. Otherwise → platform SMTP (env SMTP_*), quota-limited for marketing mail.
 *   3. No platform SMTP configured → log a mock send (development).
 *
 * Every send is scoped to ONE project's config — never "any active config".
 */

export type MailCategory = 'transactional' | 'marketing' | 'system';
export type MailVia = 'custom' | 'platform' | 'mock';

export interface SendMailInput {
    projectId?: string | Types.ObjectId | null;
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    headers?: Record<string, string>;
    category?: MailCategory;
    /** Throw instead of resolving with { sent: false } */
    throwOnError?: boolean;
}

export interface SendMailResult {
    sent: boolean;
    via: MailVia;
    messageId?: string;
    error?: string;
}

export interface PlainSMTPSettings {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
}

const transportCache = new Map<string, Transporter>();

function buildTransport(s: PlainSMTPSettings): Transporter {
    return nodemailer.createTransport({
        host: s.host,
        port: s.port,
        secure: s.secure,
        auth: { user: s.user, pass: s.pass },
        pool: true,
        maxConnections: 3,
        connectionTimeout: 15_000,
    });
}

function platformSettings(): PlainSMTPSettings | null {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    return {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port,
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    };
}

function platformFrom() {
    const raw = process.env.SMTP_FROM || 'noreply@headlesscms.com';
    const match = raw.match(/^(.*)<(.+)>$/);
    return match
        ? { name: match[1].trim().replace(/^"|"$/g, '') || 'Headless CMS', email: match[2].trim() }
        : { name: process.env.SMTP_FROM_NAME || 'Headless CMS', email: raw };
}

function customTransport(config: ISMTPConfig): Transporter {
    const key = `${config._id}:${config.updatedAt?.getTime?.() ?? 0}`;
    let t = transportCache.get(key);
    if (!t) {
        // Drop stale transports for this config
        for (const k of transportCache.keys()) {
            if (k.startsWith(`${config._id}:`)) {
                transportCache.get(k)?.close();
                transportCache.delete(k);
            }
        }
        t = buildTransport({
            host: config.smtp!.host,
            port: config.smtp!.port,
            secure: config.smtp!.secure,
            user: config.smtp!.auth.user,
            pass: decrypt(config.smtp!.auth.pass),
        });
        transportCache.set(key, t);
    }
    return t;
}

function platformTransport(): Transporter | null {
    const s = platformSettings();
    if (!s) return null;
    let t = transportCache.get('platform');
    if (!t) {
        t = buildTransport(s);
        transportCache.set('platform', t);
    }
    return t;
}

/** Monthly marketing emails included on the platform mail server, per plan. */
const PLATFORM_EMAIL_MONTHLY: Record<string, number> = {
    free: 300,
    basic: 5_000,
    starter: 5_000,
    pro: 25_000,
    professional: 25_000,
    business: 100_000,
    enterprise: 500_000,
};

export function platformEmailAllowance(plan?: string) {
    const key = (plan || 'free').toLowerCase();
    const env = process.env[`EMAIL_PLATFORM_MONTHLY_${key.toUpperCase()}`];
    const monthly = env && !isNaN(Number(env)) ? Number(env) : PLATFORM_EMAIL_MONTHLY[key] ?? PLATFORM_EMAIL_MONTHLY.free;
    return { monthlyLimit: monthly, dailyLimit: Math.max(50, Math.ceil(monthly / 10)) };
}

/** Load the project's mail settings, creating platform defaults (with plan quota) if missing. */
async function ensureProjectConfig(projectId: string | Types.ObjectId): Promise<ISMTPConfig | null> {
    const existing = await SMTPConfig.findOne({ projectId });
    if (existing) return existing;
    const project = await Project.findById(projectId).select('name tenantId').lean();
    if (!project) return null;
    const tenant = await Tenant.findById((project as any).tenantId).select('subscription.plan email').lean();
    const limits = platformEmailAllowance((tenant as any)?.subscription?.plan);
    try {
        return await SMTPConfig.create({
            projectId,
            tenantId: (project as any).tenantId,
            provider: 'system',
            fromName: (project as any).name,
            fromEmail: (tenant as any)?.email || 'noreply@example.com',
            limits: { ...limits, currentDailyCount: 0, currentMonthlyCount: 0, lastResetDate: new Date() },
        });
    } catch {
        return SMTPConfig.findOne({ projectId }); // created concurrently
    }
}

export class QuotaExceededError extends Error {
    constructor(message = 'Platform email quota reached. Connect your own SMTP server or upgrade your plan.') {
        super(message);
        this.name = 'QuotaExceededError';
    }
}

export const mailerService = {
    /** Load the project's mail config (if any). */
    async getProjectConfig(projectId?: string | Types.ObjectId | null): Promise<ISMTPConfig | null> {
        if (!projectId || !Types.ObjectId.isValid(String(projectId))) return null;
        return SMTPConfig.findOne({ projectId });
    },

    /** Whether the project sends through its own SMTP. */
    async usesOwnSmtp(projectId?: string | Types.ObjectId | null): Promise<boolean> {
        const cfg = await this.getProjectConfig(projectId);
        return Boolean(cfg && cfg.isActive && cfg.provider === 'custom' && cfg.smtp);
    },

    /** Send one email (to one or many addresses) using the project's resolved transport. */
    async send(input: SendMailInput): Promise<SendMailResult> {
        const category = input.category || 'transactional';
        const config = category === 'marketing' && input.projectId
            ? await ensureProjectConfig(input.projectId)
            : await this.getProjectConfig(input.projectId);

        let transporter: Transporter | null = null;
        let via: MailVia = 'mock';
        let fromName = input.fromName;
        let fromEmail = input.fromEmail;

        try {
            if (config && config.isActive && config.provider === 'custom' && config.smtp) {
                transporter = customTransport(config);
                via = 'custom';
                fromName = fromName || config.fromName;
                // BYO SMTP servers usually reject foreign From addresses; keep the configured one
                fromEmail = config.fromEmail || fromEmail;
            } else {
                // Platform server: enforce quota on marketing mail only
                if (category === 'marketing' && config) {
                    if (!config.canSendEmail()) throw new QuotaExceededError();
                }
                transporter = platformTransport();
                via = transporter ? 'platform' : 'mock';
                const pf = platformFrom();
                fromName = fromName || config?.fromName || pf.name;
                // Platform server can only send as the platform address
                fromEmail = pf.email;
            }

            const replyTo = input.replyTo || config?.replyTo || (via === 'platform' && config?.fromEmail ? config.fromEmail : undefined);

            if (!transporter) {
                console.log(`📧 [Mock Email] To: ${[input.to].flat().join(', ')} | Subject: ${input.subject}`);
                return { sent: true, via: 'mock' };
            }

            const info = await transporter.sendMail({
                from: `"${(fromName || '').replace(/"/g, '')}" <${fromEmail}>`,
                to: input.to,
                subject: input.subject,
                html: input.html,
                text: input.text,
                replyTo,
                headers: input.headers,
            });

            if (via === 'platform' && category === 'marketing' && config) {
                config.incrementDailyCount();
                config.incrementMonthlyCount();
                await config.save();
            }

            return { sent: true, via, messageId: info.messageId };
        } catch (err: any) {
            if (input.throwOnError || err instanceof QuotaExceededError) throw err;
            console.warn(`⚠️ Failed to send email (${via}):`, err.message);
            return { sent: false, via, error: err.message };
        }
    },

    /** Verify plain (unsaved) SMTP settings — used by the "Test connection" button. */
    async verifySettings(settings: PlainSMTPSettings): Promise<void> {
        const t = nodemailer.createTransport({
            host: settings.host,
            port: settings.port,
            secure: settings.secure,
            auth: { user: settings.user, pass: settings.pass },
            connectionTimeout: 15_000,
        });
        try {
            await t.verify();
        } finally {
            t.close();
        }
    },

    /** Decrypted settings for a saved config (server-side use only). */
    plainSettings(config: ISMTPConfig): PlainSMTPSettings | null {
        if (!config.smtp) return null;
        return {
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure,
            user: config.smtp.auth.user,
            pass: decrypt(config.smtp.auth.pass),
        };
    },

    isPlatformConfigured(): boolean {
        return platformSettings() !== null;
    },
};

export default mailerService;
