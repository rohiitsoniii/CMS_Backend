import mongoose, { Document, Schema } from 'mongoose';

export type UsageEventType = 
  | 'api_call'
  | 'content_create'
  | 'content_update'
  | 'content_delete'
  | 'media_upload'
  | 'media_delete'
  | 'login'
  | 'api_key_create';

export interface IUsageLog extends Document {
  _id: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  apiKeyId?: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  eventType: UsageEventType;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  responseTime?: number; // ms
  requestSize?: number; // bytes
  responseSize?: number; // bytes
  ipAddress?: string;
  userAgent?: string;
  referer?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

const usageLogSchema = new Schema<IUsageLog>({
  tenantId: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  apiKeyId: {
    type: Schema.Types.ObjectId,
    ref: 'APIKey',
    index: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  eventType: {
    type: String,
    enum: ['api_call', 'content_create', 'content_update', 'content_delete', 'media_upload', 'media_delete', 'login', 'api_key_create'],
    required: true,
    index: true,
  },
  endpoint: String,
  method: {
    type: String,
    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  },
  statusCode: Number,
  responseTime: Number,
  requestSize: Number,
  responseSize: Number,
  ipAddress: String,
  userAgent: String,
  referer: String,
  metadata: Schema.Types.Mixed,
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: false, // We use our own timestamp field
});

// Indexes for analytics queries
usageLogSchema.index({ tenantId: 1, timestamp: -1 });
usageLogSchema.index({ tenantId: 1, eventType: 1, timestamp: -1 });
usageLogSchema.index({ tenantId: 1, apiKeyId: 1, timestamp: -1 });

// TTL index - auto-delete logs older than 90 days
usageLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Static method to get usage stats
usageLogSchema.statics.getUsageStats = async function(
  tenantId: mongoose.Types.ObjectId,
  startDate: Date,
  endDate: Date
) {
  return this.aggregate([
    {
      $match: {
        tenantId,
        timestamp: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 },
        avgResponseTime: { $avg: '$responseTime' },
        totalRequestSize: { $sum: '$requestSize' },
        totalResponseSize: { $sum: '$responseSize' },
      },
    },
  ]);
};

// Static method to get API calls count for current month
usageLogSchema.statics.getMonthlyApiCalls = async function(tenantId: mongoose.Types.ObjectId) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const result = await this.countDocuments({
    tenantId,
    eventType: 'api_call',
    timestamp: { $gte: startOfMonth },
  });
  
  return result;
};

export const UsageLog = mongoose.model<IUsageLog>('UsageLog', usageLogSchema);
