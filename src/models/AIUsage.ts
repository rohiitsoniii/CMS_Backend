import mongoose, { Schema, Document } from 'mongoose';

/**
 * AI usage metering.
 *  - AIUsageMonthly: one counter document per tenant per month (fast quota checks)
 *  - AIUsageLog: per-call detail for the usage dashboard (auto-expires)
 */

export type AIKeySource = 'platform' | 'byok';

export interface IAIUsageMonthly extends Document {
    tenantId: mongoose.Types.ObjectId;
    month: string; // YYYY-MM
    platformTokens: number;
    byokTokens: number;
    platformRequests: number;
    byokRequests: number;
    updatedAt: Date;
}

const AIUsageMonthlySchema = new Schema<IAIUsageMonthly>(
    {
        tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
        month: { type: String, required: true },
        platformTokens: { type: Number, default: 0 },
        byokTokens: { type: Number, default: 0 },
        platformRequests: { type: Number, default: 0 },
        byokRequests: { type: Number, default: 0 },
    },
    { timestamps: true }
);
AIUsageMonthlySchema.index({ tenantId: 1, month: 1 }, { unique: true });

export const AIUsageMonthly = mongoose.model<IAIUsageMonthly>('AIUsageMonthly', AIUsageMonthlySchema);

export interface IAIUsageLog extends Document {
    tenantId?: mongoose.Types.ObjectId;
    projectId?: mongoose.Types.ObjectId;
    feature: string;
    provider: string;
    aiModel: string;
    keySource: AIKeySource;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    success: boolean;
    error?: string;
    createdAt: Date;
}

const AIUsageLogSchema = new Schema<IAIUsageLog>(
    {
        tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
        feature: { type: String, default: 'unknown' },
        provider: { type: String },
        aiModel: { type: String },
        keySource: { type: String, enum: ['platform', 'byok'] },
        inputTokens: { type: Number, default: 0 },
        outputTokens: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 },
        durationMs: { type: Number, default: 0 },
        success: { type: Boolean, default: true },
        error: { type: String },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);
AIUsageLogSchema.index({ tenantId: 1, createdAt: -1 });
// Keep detailed logs for 180 days
AIUsageLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86_400 });

export const AIUsageLog = mongoose.model<IAIUsageLog>('AIUsageLog', AIUsageLogSchema);
