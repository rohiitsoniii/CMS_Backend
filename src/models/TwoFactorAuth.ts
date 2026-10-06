import mongoose, { Document, Schema } from 'mongoose';

export interface ITwoFactorAuth extends Document {
  userId: mongoose.Types.ObjectId;
  secret: string;
  qrCodeUrl: string;
  isEnabled: boolean;
  backupCodes: string[];
  enabledAt?: Date;
}

const twoFactorAuthSchema = new Schema<ITwoFactorAuth>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  secret: { type: String, required: true },
  qrCodeUrl: { type: String },
  isEnabled: { type: Boolean, default: false },
  backupCodes: [{ type: String }],
  enabledAt: { type: Date }
}, { timestamps: true });

export const TwoFactorAuth = mongoose.model<ITwoFactorAuth>('TwoFactorAuth', twoFactorAuthSchema);