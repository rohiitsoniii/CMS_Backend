import mongoose, { Schema, Document } from 'mongoose';

export interface IAnalyticsEvent extends Document {
    projectId: mongoose.Types.ObjectId;
    
    // Event Type
    type: 'page_view' | 'click' | 'form_submit' | 'custom';
    
    // Page Info
    pageUrl: string;
    pageTitle?: string;
    referrer?: string;
    
    // User Info
    userId?: mongoose.Types.ObjectId;
    sessionId: string;
    
    // Device Info
    userAgent: string;
    device: 'desktop' | 'mobile' | 'tablet';
    browser: string;
    os: string;
    
    // Location
    ipAddress: string;
    country?: string;
    city?: string;
    
    // Timing
    timeOnPage?: number;
    scrollDepth?: number;
    
    // Custom Data
    customData?: Record<string, any>;
    
    timestamp: Date;
}

const AnalyticsEventSchema = new Schema<IAnalyticsEvent>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ['page_view', 'click', 'form_submit', 'custom'],
            default: 'page_view',
            index: true,
        },
        pageUrl: {
            type: String,
            required: true,
        },
        pageTitle: {
            type: String,
        },
        referrer: {
            type: String,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'EndUser',
        },
        sessionId: {
            type: String,
            required: true,
            index: true,
        },
        userAgent: {
            type: String,
            required: true,
        },
        device: {
            type: String,
            enum: ['desktop', 'mobile', 'tablet'],
            required: true,
        },
        browser: {
            type: String,
            required: true,
        },
        os: {
            type: String,
            required: true,
        },
        ipAddress: {
            type: String,
            required: true,
        },
        country: {
            type: String,
        },
        city: {
            type: String,
        },
        timeOnPage: {
            type: Number,
        },
        scrollDepth: {
            type: Number,
        },
        customData: {
            type: Schema.Types.Mixed,
        },
        timestamp: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: false,
    }
);

// Indexes
AnalyticsEventSchema.index({ projectId: 1, timestamp: -1 });
AnalyticsEventSchema.index({ projectId: 1, type: 1, timestamp: -1 });
AnalyticsEventSchema.index({ projectId: 1, pageUrl: 1, timestamp: -1 });
AnalyticsEventSchema.index({ projectId: 1, sessionId: 1 });

// TTL Index - Auto-delete events older than 90 days
AnalyticsEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const AnalyticsEvent = mongoose.model<IAnalyticsEvent>('AnalyticsEvent', AnalyticsEventSchema);
