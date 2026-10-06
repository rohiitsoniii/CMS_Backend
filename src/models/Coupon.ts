import mongoose, { Document, Schema } from 'mongoose';

export interface ICoupon extends Document {
  code: string;
  discountType: 'percentage' | 'fixed';
  value: number; // For percentage: 10 = 10%, For fixed: 10 = $10
  currency: string;
  expiryDate?: Date;
  usageLimit?: number;
  usedCount: number;
  minAmount?: number;
  applicablePlans: string[]; // Plan slugs
  isActive: boolean;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  
  // Methods
  isValid(): boolean;
}

const CouponSchema = new Schema<ICoupon>({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true
  },
  value: { type: Number, required: true },
  currency: { type: String, default: 'usd' },
  expiryDate: Date,
  usageLimit: Number,
  usedCount: { type: Number, default: 0 },
  minAmount: { type: Number, default: 0 },
  applicablePlans: [{ type: String }],
  isActive: { type: Boolean, default: true },
  metadata: Schema.Types.Mixed,
}, {
  timestamps: true
});

CouponSchema.methods.isValid = function(): boolean {
  if (!this.isActive) return false;
  if (this.expiryDate && this.expiryDate < new Date()) return false;
  if (this.usageLimit && this.usedCount >= this.usageLimit) return false;
  return true;
};

export const Coupon = mongoose.model<ICoupon>('Coupon', CouponSchema);
