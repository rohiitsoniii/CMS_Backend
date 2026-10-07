import mongoose, { Document, Schema } from 'mongoose';

export interface IPreviewToken extends Document {
  token: string;
  contentId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  contentTypeId: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  expiresAt: Date;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  isUsed: boolean;
  usedAt?: Date;
  isExpired(): boolean;
  isValid(): boolean;
}

const previewTokenSchema = new Schema<IPreviewToken>({
  token: { type: String, required: true, unique: true, index: true },
  contentId: { type: Schema.Types.ObjectId, required: true, ref: 'Content' },
  projectId: { type: Schema.Types.ObjectId, required: true, ref: 'Project' },
  contentTypeId: { type: Schema.Types.ObjectId, required: true, ref: 'ContentType' },
  tenantId: { type: Schema.Types.ObjectId, required: true, ref: 'Tenant' },
  expiresAt: { type: Date, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  isUsed: { type: Boolean, default: false },
  usedAt: { type: Date }
}, { timestamps: false });

previewTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

previewTokenSchema.methods.isExpired = function(): boolean {
  return new Date() > this.expiresAt;
};

previewTokenSchema.methods.isValid = function(): boolean {
  return !this.isUsed && !this.isExpired();
};

export const PreviewToken = mongoose.model<IPreviewToken>('PreviewToken', previewTokenSchema);