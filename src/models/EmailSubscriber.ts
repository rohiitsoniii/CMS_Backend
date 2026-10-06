import mongoose, { Schema, Document } from 'mongoose';

export interface IEmailSubscriber extends Document {
    projectId: mongoose.Types.ObjectId;
    
    email: string;
    name?: string;
    phone?: string;
    
    // Subscription
    status: 'subscribed' | 'unsubscribed' | 'bounced';
    subscribedAt: Date;
    unsubscribedAt?: Date;
    
    // Segmentation
    tags: string[];
    customFields: Record<string, any>;
    
    // Engagement
    totalEmailsReceived: number;
    totalEmailsOpened: number;
    totalLinksClicked: number;
    lastEmailOpenedAt?: Date;
    
    createdAt: Date;
    updatedAt: Date;
}

const EmailSubscriberSchema = new Schema<IEmailSubscriber>(
    {
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
        phone: {
            type: String,
            trim: true,
        },
        status: {
            type: String,
            enum: ['subscribed', 'unsubscribed', 'bounced'],
            default: 'subscribed',
            index: true,
        },
        subscribedAt: {
            type: Date,
            default: Date.now,
        },
        unsubscribedAt: {
            type: Date,
        },
        tags: [{
            type: String,
            trim: true,
        }],
        customFields: {
            type: Schema.Types.Mixed,
            default: {},
        },
        totalEmailsReceived: {
            type: Number,
            default: 0,
        },
        totalEmailsOpened: {
            type: Number,
            default: 0,
        },
        totalLinksClicked: {
            type: Number,
            default: 0,
        },
        lastEmailOpenedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
EmailSubscriberSchema.index({ projectId: 1, email: 1 }, { unique: true });
EmailSubscriberSchema.index({ projectId: 1, status: 1 });
EmailSubscriberSchema.index({ projectId: 1, tags: 1 });

export const EmailSubscriber = mongoose.model<IEmailSubscriber>('EmailSubscriber', EmailSubscriberSchema);
