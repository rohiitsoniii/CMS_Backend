import mongoose, { Schema, Document } from 'mongoose';

export interface ISubscription extends Document {
  tenantId: mongoose.Types.ObjectId;
  planId: mongoose.Types.ObjectId;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';
  billingCycle: 'monthly' | 'yearly';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  trialEnd?: Date;
  usage: {
    projects: number;
    contentItems: number;
    teamMembers: number;
    storage: number; // in bytes
    apiCallsThisMonth: number;
    lastResetAt: Date;
  };
  paymentMethod?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
}

const SubscriptionSchema = new Schema<ISubscription>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
  planId: { type: Schema.Types.ObjectId, ref: 'Plan', required: true },
  stripeCustomerId: { type: String, required: true },
  stripeSubscriptionId: { type: String, required: true },
  stripePriceId: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['active', 'canceled', 'past_due', 'trialing', 'incomplete'],
    default: 'active'
  },
  billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
  currentPeriodStart: { type: Date, required: true },
  currentPeriodEnd: { type: Date, required: true },
  cancelAtPeriodEnd: { type: Boolean, default: false },
  canceledAt: { type: Date },
  trialEnd: { type: Date },
  usage: {
    projects: { type: Number, default: 0 },
    contentItems: { type: Number, default: 0 },
    teamMembers: { type: Number, default: 0 },
    storage: { type: Number, default: 0 },
    apiCallsThisMonth: { type: Number, default: 0 },
    lastResetAt: { type: Date, default: Date.now }
  },
  paymentMethod: {
    brand: String,
    last4: String,
    expMonth: Number,
    expYear: Number
  }
}, { timestamps: true });

SubscriptionSchema.index({ tenantId: 1 });
SubscriptionSchema.index({ stripeCustomerId: 1 });
SubscriptionSchema.index({ status: 1 });

export const Subscription = mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
