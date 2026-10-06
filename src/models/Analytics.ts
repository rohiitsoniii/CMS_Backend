import mongoose, { Schema, Document } from 'mongoose';

export interface IAnalytics extends Document {
  tenant: mongoose.Types.ObjectId;
  type: 'api_call' | 'user_activity' | 'content_operation' | 'system_metric';
  category: string;
  action: string;
  metadata: Record<string, any>;
  userId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  apiKeyId?: mongoose.Types.ObjectId;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  responseTime?: number;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

const AnalyticsSchema = new Schema<IAnalytics>({
  tenant: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  type: { type: String, enum: ['api_call', 'user_activity', 'content_operation', 'system_metric'], required: true },
  category: { type: String, required: true, index: true },
  action: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
  apiKeyId: { type: Schema.Types.ObjectId, ref: 'APIKey', index: true },
  endpoint: String,
  method: String,
  statusCode: Number,
  responseTime: Number,
  ipAddress: String,
  userAgent: String,
  timestamp: { type: Date, default: Date.now, index: true }
}, { timestamps: false });

AnalyticsSchema.index({ tenant: 1, timestamp: -1 });
AnalyticsSchema.index({ tenant: 1, type: 1, timestamp: -1 });
AnalyticsSchema.index({ tenant: 1, category: 1, timestamp: -1 });

export const Analytics = mongoose.model<IAnalytics>('Analytics', AnalyticsSchema);
