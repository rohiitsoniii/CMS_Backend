import mongoose, { Schema, Document } from 'mongoose';

export interface IEmailCampaign extends Document {
    projectId: mongoose.Types.ObjectId;
    
    // Campaign Details
    name: string;
    subject: string;
    templateId?: mongoose.Types.ObjectId;
    htmlContent: string;
    textContent?: string;
    
    // Recipients
    recipientType: 'all' | 'segment' | 'custom';
    recipientSegment?: {
        contentType?: string;
        tags?: string[];
        customQuery?: any;
    };
    customRecipients?: string[];
    
    // Scheduling
    status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'cancelled';
    scheduledFor?: Date;
    sentAt?: Date;
    
    // Settings
    fromName: string;
    fromEmail: string;
    replyTo?: string;
    trackOpens: boolean;
    trackClicks: boolean;
    
    // Statistics
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
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        subject: {
            type: String,
            required: true,
            trim: true,
        },
        templateId: {
            type: Schema.Types.ObjectId,
            ref: 'EmailTemplate',
        },
        htmlContent: {
            type: String,
            required: true,
        },
        textContent: {
            type: String,
        },
        recipientType: {
            type: String,
            enum: ['all', 'segment', 'custom'],
            default: 'all',
        },
        recipientSegment: {
            contentType: String,
            tags: [String],
            customQuery: Schema.Types.Mixed,
        },
        customRecipients: [{
            type: String,
            trim: true,
            lowercase: true,
        }],
        status: {
            type: String,
            enum: ['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled'],
            default: 'draft',
            index: true,
        },
        scheduledFor: {
            type: Date,
        },
        sentAt: {
            type: Date,
        },
        fromName: {
            type: String,
            required: true,
            trim: true,
        },
        fromEmail: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        replyTo: {
            type: String,
            trim: true,
            lowercase: true,
        },
        trackOpens: {
            type: Boolean,
            default: true,
        },
        trackClicks: {
            type: Boolean,
            default: true,
        },
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
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
EmailCampaignSchema.index({ projectId: 1, status: 1 });
EmailCampaignSchema.index({ projectId: 1, createdAt: -1 });
EmailCampaignSchema.index({ scheduledFor: 1 });

export const EmailCampaign = mongoose.model<IEmailCampaign>('EmailCampaign', EmailCampaignSchema);
