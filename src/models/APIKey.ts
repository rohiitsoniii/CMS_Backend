import mongoose, { Document, Schema } from 'mongoose';
import crypto from 'crypto';
import { config } from '../config/index.js';

export interface IAPIKey extends Document {
  _id: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  apiKey: string; // Public key (shown to user)
  apiKeyHash: string; // Hashed version stored in DB
  secretKey: string; // Secret key (shown once)
  secretKeyHash: string; // Hashed version stored in DB
  permissions: string[];
  allowedOrigins: string[];
  allowedIps?: string[];
  rateLimit: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  isActive: boolean;
  expiresAt?: Date;
  lastUsedAt?: Date;
  usageCount: number;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  
  // Methods
  verifyApiKey(apiKey: string): boolean;
  verifySecretKey(secretKey: string): boolean;
}

export interface IAPIKeyMethods {
  verifyApiKey(apiKey: string): boolean;
  verifySecretKey(secretKey: string): boolean;
}

const apiKeySchema = new Schema<IAPIKey>({
  tenantId: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: [true, 'Tenant ID is required'],
    index: true,
  },
  name: {
    type: String,
    required: [true, 'API key name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters'],
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters'],
  },
  apiKey: {
    type: String,
    required: true,
    unique: true,
  },
  apiKeyHash: {
    type: String,
    required: true,
    select: false,
  },
  secretKey: {
    type: String,
    select: false, // Only shown once at creation
  },
  secretKeyHash: {
    type: String,
    required: true,
    select: false,
  },
  permissions: [{
    type: String,
    enum: [
      'content:read',
      'content:write',
      'media:read',
      'media:write',
    ],
    default: ['content:read'],
  }],
  allowedOrigins: [{
    type: String,
    trim: true,
  }],
  allowedIps: [{
    type: String,
    trim: true,
  }],
  rateLimit: {
    requestsPerMinute: { type: Number, default: 60 },
    requestsPerDay: { type: Number, default: 10000 },
  },
  isActive: { type: Boolean, default: true },
  expiresAt: Date,
  lastUsedAt: Date,
  usageCount: { type: Number, default: 0 },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

// Indexes
apiKeySchema.index({ apiKey: 1 });
apiKeySchema.index({ tenantId: 1, isActive: 1 });
apiKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Static method to generate API key pair
apiKeySchema.statics.generateKeyPair = function(): { apiKey: string; secretKey: string; apiKeyHash: string; secretKeyHash: string } {
  // Generate API key: prefix_randomstring
  const apiKeyPrefix = 'hcms_';
  const apiKeyRandom = crypto.randomBytes(24).toString('base64url');
  const apiKey = `${apiKeyPrefix}${apiKeyRandom}`;
  
  // Generate Secret key
  const secretKeyPrefix = 'hcms_secret_';
  const secretKeyRandom = crypto.randomBytes(32).toString('base64url');
  const secretKey = `${secretKeyPrefix}${secretKeyRandom}`;
  
  // Hash both keys
  const apiKeyHash = crypto
    .createHmac('sha256', config.apiKeySecret)
    .update(apiKey)
    .digest('hex');
    
  const secretKeyHash = crypto
    .createHmac('sha256', config.apiKeySecret)
    .update(secretKey)
    .digest('hex');
  
  return { apiKey, secretKey, apiKeyHash, secretKeyHash };
};

// Verify API key
apiKeySchema.methods.verifyApiKey = function(apiKey: string): boolean {
  const hash = crypto
    .createHmac('sha256', config.apiKeySecret)
    .update(apiKey)
    .digest('hex');
  return hash === this.apiKeyHash;
};

// Verify Secret key
apiKeySchema.methods.verifySecretKey = function(secretKey: string): boolean {
  const hash = crypto
    .createHmac('sha256', config.apiKeySecret)
    .update(secretKey)
    .digest('hex');
  return hash === this.secretKeyHash;
};

// Interface for static methods
interface IAPIKeyModel extends mongoose.Model<IAPIKey, object, IAPIKeyMethods> {
  generateKeyPair(): { apiKey: string; secretKey: string; apiKeyHash: string; secretKeyHash: string };
}

export const APIKey = mongoose.model<IAPIKey, IAPIKeyModel>('APIKey', apiKeySchema);
