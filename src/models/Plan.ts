import mongoose, { Schema, Document } from 'mongoose';

export interface IPlan extends Document {
  name: string;
  slug: string;
  description: string;
  price: {
    monthly: number;
    yearly: number;
  };
  stripePriceId: {
    monthly: string;
    yearly: string;
  };
  limits: {
    projects: number;
    contentItems: number;
    teamMembers: number;
    storage: number; // in GB
    apiCallsPerMonth: number;
    apiRateLimit: number; // requests per minute
  };
  features: string[];
  isActive: boolean;
  order: number;
}

const PlanSchema = new Schema<IPlan>({
  name: { type: String, required: true, unique: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  price: {
    monthly: { type: Number, required: true },
    yearly: { type: Number, required: true }
  },
  stripePriceId: {
    monthly: { type: String, required: true },
    yearly: { type: String, required: true }
  },
  limits: {
    projects: { type: Number, required: true },
    contentItems: { type: Number, required: true },
    teamMembers: { type: Number, required: true },
    storage: { type: Number, required: true },
    apiCallsPerMonth: { type: Number, required: true },
    apiRateLimit: { type: Number, required: true }
  },
  features: [{ type: String }],
  isActive: { type: Boolean, default: true },
  order: { type: Number, default: 0 }
}, { timestamps: true });

export const Plan = mongoose.model<IPlan>('Plan', PlanSchema);
