import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Project Model
 * 
 * A tenant can have multiple projects (websites/apps).
 * Each project has its own content, settings, and API keys.
 */

export interface IProjectSettings {
  defaultLocale: string;
  locales: string[];
  timezone: string;
  analytics?: {
    googleAnalyticsId?: string;
    facebookPixelId?: string;
  };
  seo?: {
    defaultTitle?: string;
    titleTemplate?: string;
    defaultDescription?: string;
  };
  previewUrl?: string;
}

export interface IProjectBranding {
  logo?: {
    url: string;
    alt?: string;
  };
  favicon?: {
    url: string;
  };
  colors?: {
    primary: string;
    secondary: string;
    accent?: string;
  };
}

export interface IChatbotConfig {
  enabled: boolean;
  name: string;
  avatar?: {
    url: string;
  };
  greeting: string;
  quickActions: {
    label: string;
    action: string;
  }[];
  fallbackMessage: string;
  position: 'bottom-right' | 'bottom-left';
  theme: {
    primaryColor: string;
    fontFamily?: string;
  };
  aiEnabled: boolean;
  aiModel?: string;
  systemPrompt?: string;
}

export interface IProject extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  
  // Basic info
  name: string;
  slug: string;
  description?: string;
  domain?: string;
  
  // Configuration
  settings: IProjectSettings;
  branding: IProjectBranding;
  chatbot?: IChatbotConfig;
  
  // Status
  status: 'active' | 'draft' | 'archived';
  
  // Stats (denormalized for quick access)
  stats: {
    contentCount: number;
    blogCount: number;
    apiCalls: number;
    lastPublishedAt?: Date;
  };
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
}

const ProjectSchema = new Schema<IProject>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'],
    },
    
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    
    domain: {
      type: String,
      trim: true,
      lowercase: true,
    },
    
    settings: {
      defaultLocale: {
        type: String,
        default: 'en',
      },
      locales: {
        type: [String],
        default: ['en'],
      },
      timezone: {
        type: String,
        default: 'UTC',
      },
      analytics: {
        googleAnalyticsId: String,
        facebookPixelId: String,
      },
    seo: {
        defaultTitle: String,
        titleTemplate: String,
        defaultDescription: String,
      },
      previewUrl: String,
      // Where the project's own website handles end-user account links.
      // {token} is replaced; without it ?token= is appended.
      endUserUrls: {
        verifyEmail: String,
        resetPassword: String,
      },
    },
    
    branding: {
      logo: {
        url: String,
        alt: String,
      },
      favicon: {
        url: String,
      },
      colors: {
        primary: { type: String, default: '#6366f1' },
        secondary: { type: String, default: '#8b5cf6' },
        accent: String,
      },
    },
    
    chatbot: {
      enabled: { type: Boolean, default: false },
      name: { type: String, default: 'Assistant' },
      avatar: {
        url: String,
      },
      greeting: { type: String, default: 'Hi! How can I help you today?' },
      quickActions: [{
        label: String,
        action: String,
      }],
      fallbackMessage: { type: String, default: "I'm not sure about that. Would you like to speak with a human?" },
      position: { type: String, enum: ['bottom-right', 'bottom-left'], default: 'bottom-right' },
      theme: {
        primaryColor: { type: String, default: '#6366f1' },
        fontFamily: String,
      },
      aiEnabled: { type: Boolean, default: false },
      aiModel: String,
      systemPrompt: String,
    },
    
    status: {
      type: String,
      enum: ['active', 'draft', 'archived'],
      default: 'active',
    },
    
    stats: {
      contentCount: { type: Number, default: 0 },
      blogCount: { type: Number, default: 0 },
      apiCalls: { type: Number, default: 0 },
      lastPublishedAt: Date,
    },
    
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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

// Compound index for unique slug per tenant
ProjectSchema.index({ tenantId: 1, slug: 1 }, { unique: true });

// Index for listing projects
ProjectSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

export const Project = mongoose.model<IProject>('Project', ProjectSchema);
