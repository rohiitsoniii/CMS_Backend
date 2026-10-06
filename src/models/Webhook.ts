import mongoose, { Schema, Document } from 'mongoose';

export interface IWebhook extends Document {
  tenantId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  name: string;
  url: string;
  events: string[]; // e.g., 'content.create', 'content.publish', 'media.upload'
  headers?: Record<string, string>; // Custom headers for security
  secret?: string; // HMAC secret
  isEnabled: boolean;
  failureCount: number;
  integrationType?: 'standard' | 'github' | 'gitlab';
  lastTriggeredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookSchema: Schema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  name: { type: String, required: true },
  url: { type: String, required: true },
  events: [{ type: String, required: true }],
  headers: { type: Map, of: String },
  secret: { type: String },
  isEnabled: { type: Boolean, default: true },
  failureCount: { type: Number, default: 0 },
  integrationType: { type: String, enum: ['standard', 'github', 'gitlab'], default: 'standard' },
  lastTriggeredAt: { type: Date }
}, {
  timestamps: true
});

WebhookSchema.index({ tenantId: 1, projectId: 1 });

export default mongoose.model<IWebhook>('Webhook', WebhookSchema);
