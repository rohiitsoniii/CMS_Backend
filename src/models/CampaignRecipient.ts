import mongoose, { Schema, Document } from 'mongoose';

export type RecipientStatus = 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed' | 'skipped';

export interface ICampaignRecipient extends Document {
    campaignId: mongoose.Types.ObjectId;
    projectId: mongoose.Types.ObjectId;
    subscriberId?: mongoose.Types.ObjectId;

    // Recipient Info
    email: string;
    name?: string;

    /** Opaque per-recipient token used in open/click/unsubscribe links */
    token: string;

    // Tracking
    status: RecipientStatus;
    sentAt?: Date;
    deliveredAt?: Date;
    openedAt?: Date;
    clickedAt?: Date;
    bouncedAt?: Date;
    unsubscribedAt?: Date;

    // Engagement
    openCount: number;
    clickCount: number;
    clicks: {
        url: string;
        clickedAt: Date;
    }[];

    attempts: number;
    error?: string;

    createdAt: Date;
    updatedAt: Date;
}

const CampaignRecipientSchema = new Schema<ICampaignRecipient>(
    {
        campaignId: { type: Schema.Types.ObjectId, ref: 'EmailCampaign', required: true },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
        subscriberId: { type: Schema.Types.ObjectId, ref: 'EmailSubscriber' },
        email: { type: String, required: true, trim: true, lowercase: true },
        name: { type: String, trim: true },
        // sparse: legacy rows created before tracking tokens existed have none
        token: { type: String, required: true, unique: true, sparse: true },
        status: {
            type: String,
            enum: ['pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'skipped'],
            default: 'pending',
        },
        sentAt: { type: Date },
        deliveredAt: { type: Date },
        openedAt: { type: Date },
        clickedAt: { type: Date },
        bouncedAt: { type: Date },
        unsubscribedAt: { type: Date },
        openCount: { type: Number, default: 0 },
        clickCount: { type: Number, default: 0 },
        clicks: [{
            url: { type: String, required: true },
            clickedAt: { type: Date, default: Date.now },
        }],
        attempts: { type: Number, default: 0 },
        error: { type: String },
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
