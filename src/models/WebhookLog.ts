import mongoose, { Document, Schema } from 'mongoose';

export interface IWebhookLog extends Document {
  webhookId: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  event: string;
  payload: any;
  response: {
    statusCode: number;
    body: string;
    duration: number;
  };
  status: 'success' | 'failed' | 'pending' | 'retrying';
  error?: string;
  attempts: number;
  nextRetryAt?: Date;
  createdAt: Date;
  triggeredBy: mongoose.Types.ObjectId;
}

const webhookLogSchema = new Schema<IWebhookLog>({
  webhookId: { type: Schema.Types.ObjectId, ref: 'Webhook', required: true },
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  event: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, default: {} },
  response: {
    statusCode: Number,
    body: String,
    duration: { type: Number, default: 0 }
  },
  status: {
    type: String,
    enum: ['success', 'failed', 'pending', 'retrying'],
    default: 'pending'
  },
  error: String,
  attempts: { type: Number, default: 1 },
  nextRetryAt: Date,
  triggeredBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: true, updatedAt: false } });

webhookLogSchema.index({ tenantId: 1, createdAt: -1 });
webhookLogSchema.index({ webhookId: 1, createdAt: -1 });
webhookLogSchema.index({ status: 1, createdAt: -1 });

export const WebhookLog = mongoose.model<IWebhookLog>('WebhookLog', webhookLogSchema);