import mongoose, { Document, Schema } from 'mongoose';

export interface IConsentLog extends Document {
  userId?: mongoose.Types.ObjectId;
  tenantId?: mongoose.Types.ObjectId;
  ipAddress: string;
  userAgent: string;
  consentType: 'cookies' | 'terms_of_service' | 'privacy_policy' | 'data_processing';
  action: 'granted' | 'revoked';
  version: string;
  createdAt: Date;
}

const ConsentLogSchema = new Schema<IConsentLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
  ipAddress: { type: String, required: true },
  userAgent: { type: String, required: true },
  consentType: { 
    type: String, 
    enum: ['cookies', 'terms_of_service', 'privacy_policy', 'data_processing'],
    required: true 
  },
  action: { type: String, enum: ['granted', 'revoked'], required: true },
  version: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

// Consent logs are immutable audit records
ConsentLogSchema.index({ userId: 1, consentType: 1 });
ConsentLogSchema.index({ ipAddress: 1 });

export const ConsentLog = mongoose.model<IConsentLog>('ConsentLog', ConsentLogSchema);
