import mongoose, { Schema, Document } from 'mongoose';

export interface ICampaignRecipient extends Document {
    campaignId: mongoose.Types.ObjectId;
    projectId: mongoose.Types.ObjectId;
    
    // Recipient Info
    email: string;
    name?: string;
    
    // Tracking
    status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
    sentAt?: Date;
    deliveredAt?: Date;
    openedAt?: Date;
    clickedAt?: Date;
    bouncedAt?: Date;
    
    // Engagement
    openCount: number;
    clickCount: number;
    clicks: {
        url: string;
        clickedAt: Date;
    }[];
    
    // Error handling
    error?: string;
    
    createdAt: Date;
    updatedAt: Date;
}

const CampaignRecipientSchema = new Schema<ICampaignRecipient>(
    {
        campaignId: {
            type: Schema.Types.ObjectId,
            ref: 'EmailCampaign',
            required: true,
            index: true,
        },
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        name: {
            type: String,
            trim: true,
        },
        status: {
            type: String,
            enum: ['pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'],
            default: 'pending',
            index: true,
        },
        sentAt: {
            type: Date,
        },
        deliveredAt: {
            type: Date,
        },
        openedAt: {
            type: Date,
        },
        clickedAt: {
            type: Date,
        },
        bouncedAt: {
            type: Date,
        },
        openCount: {
            type: Number,
            default: 0,
        },
        clickCount: {
            type: Number,
            default: 0,
        },
        clicks: [{
            url: {
                type: String,
                required: true,
            },
            clickedAt: {
                type: Date,
                default: Date.now,
            },
        }],
        error: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
CampaignRecipientSchema.index({ campaignId: 1, email: 1 }, { unique: true });
CampaignRecipientSchema.index({ campaignId: 1, status: 1 });
CampaignRecipientSchema.index({ email: 1 });

export const CampaignRecipient = mongoose.model<ICampaignRecipient>('CampaignRecipient', CampaignRecipientSchema);
