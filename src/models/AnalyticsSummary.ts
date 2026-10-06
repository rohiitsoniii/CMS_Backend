import mongoose, { Schema, Document } from 'mongoose';

export interface ITopPage {
    url: string;
    title: string;
    views: number;
    avgTimeOnPage: number;
}

export interface ITrafficSource {
    source: string;
    visitors: number;
    percentage: number;
}

export interface IDeviceStats {
    desktop: number;
    mobile: number;
    tablet: number;
}

export interface IBrowserStat {
    name: string;
    count: number;
}

export interface ICountryStat {
    name: string;
    count: number;
}

export interface IAnalyticsSummary extends Document {
    projectId: mongoose.Types.ObjectId;
    date: Date;
    
    // Overall Metrics
    totalPageViews: number;
    uniqueVisitors: number;
    totalSessions: number;
    avgSessionDuration: number;
    bounceRate: number;
    
    // Top Pages
    topPages: ITopPage[];
    
    // Traffic Sources
    trafficSources: ITrafficSource[];
    
    // Devices
    devices: IDeviceStats;
    
    // Browsers
    browsers: IBrowserStat[];
    
    // Countries
    countries: ICountryStat[];
    
    createdAt: Date;
    updatedAt: Date;
}

const TopPageSchema = new Schema({
    url: String,
    title: String,
    views: Number,
    avgTimeOnPage: Number,
}, { _id: false });

const TrafficSourceSchema = new Schema({
    source: String,
    visitors: Number,
    percentage: Number,
}, { _id: false });

const DeviceStatsSchema = new Schema({
    desktop: { type: Number, default: 0 },
    mobile: { type: Number, default: 0 },
    tablet: { type: Number, default: 0 },
}, { _id: false });

const BrowserStatSchema = new Schema({
    name: String,
    count: Number,
}, { _id: false });

const CountryStatSchema = new Schema({
    name: String,
    count: Number,
}, { _id: false });

const AnalyticsSummarySchema = new Schema<IAnalyticsSummary>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        date: {
            type: Date,
            required: true,
            index: true,
        },
        totalPageViews: {
            type: Number,
            default: 0,
        },
        uniqueVisitors: {
            type: Number,
            default: 0,
        },
        totalSessions: {
            type: Number,
            default: 0,
        },
        avgSessionDuration: {
            type: Number,
            default: 0,
        },
        bounceRate: {
            type: Number,
            default: 0,
        },
        topPages: [TopPageSchema],
        trafficSources: [TrafficSourceSchema],
        devices: {
            type: DeviceStatsSchema,
            default: () => ({}),
        },
        browsers: [BrowserStatSchema],
        countries: [CountryStatSchema],
    },
    {
        timestamps: true,
    }
);

// Indexes
AnalyticsSummarySchema.index({ projectId: 1, date: -1 }, { unique: true });

// Static method to get or create summary for a date
AnalyticsSummarySchema.statics.getOrCreate = async function(projectId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    let summary = await this.findOne({
        projectId,
        date: startOfDay,
    });
    
    if (!summary) {
        summary = await this.create({
            projectId,
            date: startOfDay,
            totalPageViews: 0,
            uniqueVisitors: 0,
            totalSessions: 0,
            avgSessionDuration: 0,
            bounceRate: 0,
            topPages: [],
            trafficSources: [],
            devices: { desktop: 0, mobile: 0, tablet: 0 },
            browsers: [],
            countries: [],
        });
    }
    
    return summary;
};

export const AnalyticsSummary = mongoose.model<IAnalyticsSummary>('AnalyticsSummary', AnalyticsSummarySchema);
