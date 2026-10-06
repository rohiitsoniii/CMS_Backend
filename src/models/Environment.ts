/**
 * Environment Model
 * 
 * Manages different environments (development, staging, production)
 */

import { Schema, model, Document, Types } from 'mongoose';

export interface IEnvironment extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  slug: string;
  type: 'development' | 'staging' | 'production' | 'custom';
  description?: string;
  
  // Environment configuration
  config: {
    apiUrl?: string;
    previewUrl?: string;
    cdnUrl?: string;
    customDomain?: string;
  };
  
  // Access control
  isPublic: boolean;
  allowedIPs?: string[];
  
  // Content sync
  syncFrom?: Types.ObjectId; // Environment to sync from
  lastSyncAt?: Date;
  autoSync: boolean;
  
  // Status
  isActive: boolean;
  isDefault: boolean;
  
  // Metadata
  createdAt: Date;
  createdBy: Types.ObjectId;
  updatedAt: Date;
  updatedBy?: Types.ObjectId;
}

const EnvironmentSchema = new Schema<IEnvironment>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    
    name: {
      type: String,
      required: true,
      trim: true,
    },
    
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    
    type: {
      type: String,
      enum: ['development', 'staging', 'production', 'custom'],
      default: 'development',
    },
    
    description: {
      type: String,
      trim: true,
    },
    
    config: {
      apiUrl: String,
      previewUrl: String,
      cdnUrl: String,
      customDomain: String,
    },
    
    isPublic: {
      type: Boolean,
      default: false,
    },
    
    allowedIPs: [String],
    
    syncFrom: {
      type: Schema.Types.ObjectId,
      ref: 'Environment',
    },
    
    lastSyncAt: Date,
    
    autoSync: {
      type: Boolean,
      default: false,
    },
    
    isActive: {
      type: Boolean,
      default: true,
    },
    
    isDefault: {
      type: Boolean,
      default: false,
    },
    
    createdAt: {
      type: Date,
      default: Date.now,
    },
    
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
EnvironmentSchema.index({ projectId: 1, slug: 1 }, { unique: true });
EnvironmentSchema.index({ projectId: 1, isDefault: 1 });

// Ensure only one default environment per project
EnvironmentSchema.pre('save', async function (next) {
  if (this.isDefault && this.isModified('isDefault')) {
    await Environment.updateMany(
      { projectId: this.projectId, _id: { $ne: this._id } },
      { $set: { isDefault: false } }
    );
  }
  next();
});

export const Environment = model<IEnvironment>('Environment', EnvironmentSchema);
