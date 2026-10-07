import mongoose, { Schema, Document } from 'mongoose';
import { encrypt, isEncrypted } from '../services/cryptoService.js';

/**
 * Well-known SMTP presets. Every major transactional/marketing provider
 * exposes an SMTP relay, so one transport covers Gmail, Outlook, SendGrid,
 * Resend, SES, Mailgun, Brevo and any custom server.
 */
export const SMTP_PRESETS = {
    gmail: { host: 'smtp.gmail.com', port: 587, secure: false, hint: 'Use a Google App Password (requires 2-Step Verification).' },
    outlook: { host: 'smtp.office365.com', port: 587, secure: false, hint: 'Use your Microsoft 365 / Outlook credentials.' },
    sendgrid: { host: 'smtp.sendgrid.net', port: 587, secure: false, hint: 'Username is literally "apikey", password is your SendGrid API key.' },
    resend: { host: 'smtp.resend.com', port: 465, secure: true, hint: 'Username is "resend", password is your Resend API key.' },
    ses: { host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: false, hint: 'Use SES SMTP credentials; change the region in the host if needed.' },
    mailgun: { host: 'smtp.mailgun.org', port: 587, secure: false, hint: 'Use the SMTP credentials from your Mailgun domain settings.' },
    brevo: { host: 'smtp-relay.brevo.com', port: 587, secure: false, hint: 'Use your Brevo SMTP login and SMTP key.' },
    zoho: { host: 'smtp.zoho.com', port: 465, secure: true, hint: 'Use your Zoho Mail address and an app-specific password.' },
    custom: { host: '', port: 587, secure: false, hint: 'Any SMTP server.' },
} as const;

export type SMTPPreset = keyof typeof SMTP_PRESETS;

export interface ISMTPSettings {
    host: string;
    port: number;
    secure: boolean;
    auth: {
        user: string;
        /** AES-256-GCM encrypted at rest — never return to clients. */
        pass: string;
    };
}

export interface IEmailLimits {
    dailyLimit: number;
    monthlyLimit: number;
    currentDailyCount: number;
    currentMonthlyCount: number;
    lastResetDate: Date;
    /** YYYY-MM the monthly counter belongs to */
    currentMonth?: string;
}

export interface ISMTPConfig extends Document {
    projectId: mongoose.Types.ObjectId;
    tenantId?: mongoose.Types.ObjectId;

    // 'custom' = tenant's own SMTP (BYO), 'system' = platform mail server with quota
    provider: 'custom' | 'system';
    preset?: SMTPPreset;

    // Custom SMTP (if provider = 'custom')
    smtp?: ISMTPSettings;

    // Email Settings
    fromName: string;
    fromEmail: string;
    replyTo?: string;
    /** Postal address appended to marketing emails (CAN-SPAM requirement) */
    physicalAddress?: string;
    /** Require email confirmation for public sign-ups */
    doubleOptIn: boolean;

    // Limits (platform SMTP only)
    limits?: IEmailLimits;

    // Status
    isActive: boolean;
    isVerified: boolean;
    lastTestedAt?: Date;
    lastError?: string;

    createdAt: Date;
    updatedAt: Date;

    // Methods
    incrementDailyCount(): void;
    incrementMonthlyCount(): void;
    resetDailyCount(): void;
    resetMonthlyCount(): void;
    canSendEmail(): boolean;
}

const SMTPSettingsSchema = new Schema({
    host: { type: String, required: true, trim: true },
    port: { type: Number, required: true },
    secure: { type: Boolean, default: false },
    auth: {
        user: { type: String, required: true, trim: true },
        pass: { type: String, required: true },
    },
}, { _id: false });

const EmailLimitsSchema = new Schema({
    dailyLimit: { type: Number, default: 100 },
    monthlyLimit: { type: Number, default: 1000 },
    currentDailyCount: { type: Number, default: 0 },
    currentMonthlyCount: { type: Number, default: 0 },
    lastResetDate: { type: Date, default: Date.now },
    currentMonth: { type: String },
}, { _id: false });

const SMTPConfigSchema = new Schema<ISMTPConfig>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            unique: true,
            index: true,
        },
        tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
        provider: {
            type: String,
            enum: ['custom', 'system'],
            default: 'system',
        },
        preset: {
            type: String,
            enum: Object.keys(SMTP_PRESETS),
            default: 'custom',
        },
        smtp: SMTPSettingsSchema,
        fromName: { type: String, required: true, trim: true },
        fromEmail: { type: String, required: true, trim: true, lowercase: true },
        replyTo: { type: String, trim: true, lowercase: true },
        physicalAddress: { type: String, trim: true, maxlength: 500 },
        doubleOptIn: { type: Boolean, default: false },
        limits: { type: EmailLimitsSchema, default: () => ({}) },
        isActive: { type: Boolean, default: true },
        isVerified: { type: Boolean, default: false },
        lastTestedAt: { type: Date },
        lastError: { type: String },
    },
    {
        timestamps: true,
        toJSON: {
            transform: (_doc, ret: any) => {
                // Never leak the SMTP password, even encrypted
                if (ret.smtp?.auth) {
                    ret.smtp.auth = { user: ret.smtp.auth.user, hasPassword: Boolean(ret.smtp.auth.pass) };
                }
                return ret;
            },
        },
    }
);

// Encrypt the SMTP password at rest
SMTPConfigSchema.pre('save', function (next) {
    const pass = this.smtp?.auth?.pass;
    if (pass && !isEncrypted(pass)) {
        this.smtp!.auth.pass = encrypt(pass);
    }
    next();
});

const monthKey = () => new Date().toISOString().slice(0, 7);

// Methods
SMTPConfigSchema.methods.incrementDailyCount = function () {
    if (!this.limits) return;
    this.limits.currentDailyCount += 1;
};

SMTPConfigSchema.methods.incrementMonthlyCount = function () {
    if (!this.limits) return;
    this.limits.currentMonthlyCount += 1;
};

SMTPConfigSchema.methods.resetDailyCount = function () {
    if (!this.limits) return;
    this.limits.currentDailyCount = 0;
    this.limits.lastResetDate = new Date();
};

SMTPConfigSchema.methods.resetMonthlyCount = function () {
    if (!this.limits) return;
    this.limits.currentMonthlyCount = 0;
    this.limits.currentMonth = monthKey();
};

SMTPConfigSchema.methods.canSendEmail = function (): boolean {
    if (this.provider === 'custom') return true;
    if (!this.limits) return false;

    // Roll counters over lazily
    const last: Date = this.limits.lastResetDate || new Date(0);
    if (last.toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
        this.resetDailyCount();
    }
    if (this.limits.currentMonth !== monthKey()) {
        this.resetMonthlyCount();
    }

    return (
        this.limits.currentDailyCount < this.limits.dailyLimit &&
        this.limits.currentMonthlyCount < this.limits.monthlyLimit
    );
};

// Static method to get or create config
SMTPConfigSchema.statics.getOrCreate = async function (projectId: string, defaults: any) {
    let config = await this.findOne({ projectId });

    if (!config) {
        config = await this.create({
            projectId,
            ...defaults,
        });
    }

    return config;
};

export const SMTPConfig = mongoose.model<ISMTPConfig>('SMTPConfig', SMTPConfigSchema);
