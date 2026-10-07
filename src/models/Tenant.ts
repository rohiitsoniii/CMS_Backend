import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

// Subscription Plan Types
export type PlanType = 'free' | 'basic' | 'pro' | 'enterprise';

export interface ISubscription {
  plan: PlanType;
  startDate: Date;
  endDate?: Date;
  isActive: boolean;
  billingCycle: 'monthly' | 'yearly';
  customLimits?: {
    blogPosts?: number;
    heroSections?: number;
    navigationMenus?: number;
    apiCallsPerMonth?: number;
    storageBytes?: number;
    teamMembers?: number;
  };
}

export interface ITenant extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  email: string;
  password: string;
  company?: string;
  website?: string;
  logo?: string;
  stripeCustomerId?: string; // Stripe customer ID for billing
  subscription: ISubscription;
  settings: {
    timezone: string;
    defaultLanguage: string;
    allowedOrigins: string[];
    allowedIps: string[];
    webhookUrl?: string;
    webhookSecret?: string;
  };
  usage: {
    currentMonth: string; // Format: "2025-01"
    apiCalls: number;
    storageUsed: number;
    contentCount: {
      blogPosts: number;
      heroSections: number;
      navigationMenus: number;
      footerSections: number;
      customBlocks: number;
    };
  };
  isActive: boolean;
  isEmailVerified: boolean;
  emailVerificationToken?: string;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  /** SHA-256 hex hash of the per-tenant SCIM bearer token (raw token is never stored). */
  scimToken?: string;
  scimEnabled?: boolean;
  lastLoginAt?: Date;
  onboarding: {
    projectCreated: boolean;
    contentTypesCreated: boolean;
    teamInvited: boolean;
    apiKeyCreated: boolean;
    completedAt?: Date;
  };
  whiteLabel?: {
    logoUrl?: string;
    primaryColor?: string;
    customDomain?: string;
    faviconUrl?: string;
    companyName?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  
  // Methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  resetUsageIfNewMonth(): void;
}

const subscriptionSchema = new Schema<ISubscription>({
  plan: {
    type: String,
    enum: ['free', 'basic', 'pro', 'enterprise'],
    default: 'free',
  },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  isActive: { type: Boolean, default: true },
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly'],
    default: 'monthly',
  },
  customLimits: {
    blogPosts: Number,
    heroSections: Number,
    navigationMenus: Number,
    apiCallsPerMonth: Number,
    storageBytes: Number,
    teamMembers: Number,
  },
}, { _id: false });

const tenantSchema = new Schema<ITenant>({
  name: {
    type: String,
    required: [true, 'Tenant name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters'],
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
  },
  company: {
    type: String,
    trim: true,
    maxlength: [200, 'Company name cannot exceed 200 characters'],
  },
  website: {
    type: String,
    trim: true,
  },
  logo: {
    type: String,
  },
  stripeCustomerId: {
    type: String,
    sparse: true
  },
  subscription: {
    type: subscriptionSchema,
    default: () => ({
      plan: 'free',
      startDate: new Date(),
      isActive: true,
      billingCycle: 'monthly',
    }),
  },
  settings: {
    timezone: { type: String, default: 'UTC' },
    defaultLanguage: { type: String, default: 'en' },
    allowedOrigins: [{ type: String }],
    allowedIps: [{ type: String }],
    webhookUrl: String,
    webhookSecret: String,
  },
  usage: {
    currentMonth: { type: String, default: () => new Date().toISOString().slice(0, 7) },
    apiCalls: { type: Number, default: 0 },
    storageUsed: { type: Number, default: 0 },
    contentCount: {
      blogPosts: { type: Number, default: 0 },
      heroSections: { type: Number, default: 0 },
      navigationMenus: { type: Number, default: 0 },
      footerSections: { type: Number, default: 0 },
      customBlocks: { type: Number, default: 0 },
    },
  },
  isActive: { type: Boolean, default: true },
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: String,
  passwordResetToken: String,
  passwordResetExpires: Date,
  scimToken: { type: String, select: false },
  scimEnabled: { type: Boolean, default: false },
  lastLoginAt: Date,
  onboarding: {
    projectCreated: { type: Boolean, default: false },
    contentTypesCreated: { type: Boolean, default: false },
    teamInvited: { type: Boolean, default: false },
    apiKeyCreated: { type: Boolean, default: false },
    completedAt: Date
  },
  whiteLabel: {
    logoUrl: String,
    primaryColor: { type: String, default: '#4f46e5' },
    customDomain: String,
    faviconUrl: String,
    companyName: String
  }
}, {
  timestamps: true,
});

// Indexes
tenantSchema.index({ email: 1 });
tenantSchema.index({ slug: 1 });
tenantSchema.index({ 'subscription.plan': 1 });
tenantSchema.index({ isActive: 1 });

// Hash password before saving
tenantSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
tenantSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// Reset usage if new month
tenantSchema.methods.resetUsageIfNewMonth = function(): void {
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (this.usage.currentMonth !== currentMonth) {
    this.usage.currentMonth = currentMonth;
    this.usage.apiCalls = 0;
  }
};

export const Tenant = mongoose.model<ITenant>('Tenant', tenantSchema);
