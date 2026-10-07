import mongoose, { Schema, Document } from 'mongoose';

export type SubscriberStatus = 'pending' | 'subscribed' | 'unsubscribed' | 'bounced' | 'complained';

export interface IEmailSubscriber extends Document {
    projectId: mongoose.Types.ObjectId;

    email: string;
    name?: string;
    phone?: string;

    // pending = awaiting double opt-in confirmation
    status: SubscriberStatus;
    subscribedAt: Date;
    unsubscribedAt?: Date;
    unsubscribeReason?: string;
    confirmedAt?: Date;
    confirmToken?: string;

    // Where the contact came from (form, popup, chatbot, import, manual, api)
    source: string;
    sourceDetail?: string; // form name, page URL, bot name...
    utm?: {
        source?: string;
        medium?: string;
        campaign?: string;
        term?: string;
        content?: string;
    };
    consentIp?: string;
    consentText?: string;

    tags: string[];
    customFields: Record<string, any>;

    totalEmailsReceived: number;
    totalEmailsOpened: number;
    totalLinksClicked: number;
    lastEmailSentAt?: Date;
    lastEmailOpenedAt?: Date;
    lastLinkClickedAt?: Date;
    bounceCount: number;

    createdAt: Date;
    updatedAt: Date;
}

const EmailSubscriberSchema = new Schema<IEmailSubscriber>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            maxlength: 254,
        },
        name: { type: String, trim: true, maxlength: 200 },
        phone: { type: String, trim: true, maxlength: 50 },
        status: {
            type: String,
            enum: ['pending', 'subscribed', 'unsubscribed', 'bounced', 'complained'],
            default: 'subscribed',
        },
        subscribedAt: { type: Date, default: Date.now },
        unsubscribedAt: { type: Date },
        unsubscribeReason: { type: String, maxlength: 500 },
        confirmedAt: { type: Date },
        confirmToken: { type: String, index: { sparse: true } },
        source: { type: String, default: 'manual', trim: true, maxlength: 50 },
        sourceDetail: { type: String, trim: true, maxlength: 500 },
        utm: {
            source: String,
            medium: String,
            campaign: String,
            term: String,
            content: String,
        },
        consentIp: { type: String },
        consentText: { type: String, maxlength: 1000 },
        tags: [{ type: String, trim: true, lowercase: true, maxlength: 64 }],
        customFields: { type: Schema.Types.Mixed, default: {} },
        totalEmailsReceived: { type: Number, default: 0 },
        totalEmailsOpened: { type: Number, default: 0 },
        totalLinksClicked: { type: Number, default: 0 },
        lastEmailSentAt: { type: Date },
        lastEmailOpenedAt: { type: Date },
        lastLinkClickedAt: { type: Date },
        bounceCount: { type: Number, default: 0 },
    },
    {
        timestamps: true,
        toJSON: {
            transform: (_doc, ret: any) => {
                delete ret.confirmToken;
                return ret;
            },
        },
    }
);

// Indexes
EmailSubscriberSchema.index({ projectId: 1, email: 1 }, { unique: true });
EmailSubscriberSchema.index({ projectId: 1, status: 1 });
EmailSubscriberSchema.index({ projectId: 1, tags: 1 });
EmailSubscriberSchema.index({ projectId: 1, source: 1 });
EmailSubscriberSchema.index({ projectId: 1, createdAt: -1 });

export const EmailSubscriber = mongoose.model<IEmailSubscriber>('EmailSubscriber', EmailSubscriberSchema);
