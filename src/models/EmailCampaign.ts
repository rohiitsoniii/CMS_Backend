import mongoose, { Schema, Document } from 'mongoose';

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'cancelled' | 'failed';

export interface IEmailCampaign extends Document {
    projectId: mongoose.Types.ObjectId;
    tenantId?: mongoose.Types.ObjectId;

    // Campaign Info
    name: string;
    subject: string;
    previewText?: string;
    templateId?: mongoose.Types.ObjectId;
    htmlContent: string;
    textContent?: string;

    // Audience: everyone subscribed, a saved segment, quick tag filter, or a pasted list
    recipientType: 'all' | 'segment' | 'tags' | 'custom';
    segmentId?: mongoose.Types.ObjectId;
    recipientSegment?: {
        tags?: string[];
    };
    customRecipients?: string[];

    // Status
    status: CampaignStatus;
    scheduledFor?: Date;
    startedAt?: Date;
    sentAt?: Date;
    lastError?: string;

    // Settings
    fromName: string;
    fromEmail?: string;
    replyTo?: string;
    trackOpens: boolean;
    trackClicks: boolean;

    // Statistics (opened/clicked are unique per recipient)
    stats: {
        totalRecipients: number;
        sent: number;
        delivered: number;
        opened: number;
        clicked: number;
        bounced: number;
        unsubscribed: number;
        failed: number;
    };

    createdBy: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const EmailCampaignSchema = new Schema<IEmailCampaign>(
    {
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
        tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
        name: { type: String, required: true, trim: true, maxlength: 200 },
        subject: { type: String, required: true, trim: true, maxlength: 300 },
        previewText: { type: String, trim: true, maxlength: 300 },
        templateId: { type: Schema.Types.ObjectId, ref: 'EmailTemplate' },
        htmlContent: { type: String, required: true },
        textContent: { type: String },
        recipientType: {
            type: String,
            enum: ['all', 'segment', 'tags', 'custom'],
            default: 'all',
        },
        segmentId: { type: Schema.Types.ObjectId, ref: 'EmailSegment' },
        recipientSegment: {
            tags: [String],
        },
        customRecipients: [{ type: String, trim: true, lowercase: true }],
        status: {
            type: String,
            enum: ['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled', 'failed'],
            default: 'draft',
        },
        scheduledFor: { type: Date },
        startedAt: { type: Date },
        sentAt: { type: Date },
        lastError: { type: String },
        fromName: { type: String, required: true, trim: true },
        fromEmail: { type: String, trim: true, lowercase: true },
        replyTo: { type: String, trim: true, lowercase: true },
        trackOpens: { type: Boolean, default: true },
        trackClicks: { type: Boolean, default: true },
        stats: {
            totalRecipients: { type: Number, default: 0 },
            sent: { type: Number, default: 0 },
            delivered: { type: Number, default: 0 },
            opened: { type: Number, default: 0 },
            clicked: { type: Number, default: 0 },
            bounced: { type: Number, default: 0 },
            unsubscribed: { type: Number, default: 0 },
            failed: { type: Number, default: 0 },
        },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    },
    {
        timestamps: true,
    }
);

// Indexes
EmailCampaignSchema.index({ projectId: 1, status: 1 });
EmailCampaignSchema.index({ projectId: 1, createdAt: -1 });
EmailCampaignSchema.index({ status: 1, scheduledFor: 1 });

export const EmailCampaign = mongoose.model<IEmailCampaign>('EmailCampaign', EmailCampaignSchema);
