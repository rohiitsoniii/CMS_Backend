import mongoose, { Document, Schema, Types } from 'mongoose';
import { sanitizeContentData } from '../services/sanitizerService';


/**
 * Content Types Enum
 * All supported content types in the system
 */
export const ContentTypes = {
  HEADER: 'header',
  FOOTER: 'footer',
  HERO: 'hero',
  BLOG: 'blog',
  PAGE: 'page',
  FAQ: 'faq',
  TESTIMONIAL: 'testimonial',
  BANNER: 'banner',
  POPUP: 'popup',
  NAVIGATION: 'navigation',
  GALLERY: 'gallery',
  TEAM: 'team',
  PRICING: 'pricing',
  FEATURE: 'feature',
  CTA: 'cta',
  CUSTOM: 'custom',
} as const;

export type ContentType = typeof ContentTypes[keyof typeof ContentTypes];

/**
 * Content Status
 */
export type ContentStatus = 'draft' | 'published' | 'scheduled' | 'archived';

/**
 * Version History Entry
 */
export interface IVersionEntry {
  version: number;
  data: Record<string, unknown>;
  localizedData?: Record<string, Record<string, unknown>>;
  changedBy: Types.ObjectId;
  changedAt: Date;
  changeNote?: string;
  status: ContentStatus;
}

/**
 * SEO Configuration
 */
export interface ISeoData {
  metaTitle?: string;
  metaDescription?: string;
  ogImage?: {
    url: string;
    alt?: string;
  };
  noIndex?: boolean;
  noFollow?: boolean;
  canonicalUrl?: string;
}

/**
 * Content Interface
 */
export interface IContent extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  tenantId: Types.ObjectId;
  
  // Content identification
  type: ContentType;
  name: string;
  slug?: string;
  
  // Schema-based content (NEW)
  contentTypeId?: Types.ObjectId; // Reference to ContentType for dynamic schemas
  contentTypeApiId?: string; // Denormalized for faster queries
  
  // Status & visibility
  status: ContentStatus;
  publishedAt?: Date;
  isDefault: boolean;
  visibility: 'public' | 'private' | 'password';
  password?: string;
  
  // The actual content data (flexible JSON)
  data: Record<string, unknown>;
  
  // Localization
  locale: string;
  localizedData?: {
    [locale: string]: Record<string, unknown>;
  };
  
  // Metadata
  meta: {
    page?: string;
    section?: string;
    order?: number;
    featured?: boolean;
    pinned?: boolean;
    publishedAt?: Date;
    scheduledAt?: Date;
    expiresAt?: Date;
    author?: Types.ObjectId;
    category?: string;
    tags?: string[];
    readTime?: number;
  };
  
  // SEO
  seo?: ISeoData;
  
  // Relationships (NEW)
  relationships?: {
    [fieldName: string]: Types.ObjectId | Types.ObjectId[];
  };
  
  // Scheduling (NEW)
  scheduling?: {
    publishAt?: Date;
    unpublishAt?: Date;
    recurring?: {
      pattern: string; // cron pattern
      endDate?: Date;
    };
  };
  
  // Versioning
  version: number;
  publishedVersion?: number;
  versionHistory: IVersionEntry[];
  
  // Soft delete
  isDeleted: boolean;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  
  // Audit
  createdAt: Date;
  createdBy: Types.ObjectId;
  updatedAt: Date;
  updatedBy?: Types.ObjectId;

  // Methods
  publish(): Promise<IContent>;
  unpublish(): Promise<IContent>;
  saveVersion(changedBy: string | Types.ObjectId, changeNote?: string): Promise<void>;
  populateRelationships(): Promise<IContent>;
}


const VersionEntrySchema = new Schema<IVersionEntry>(
  {
    version: { type: Number, required: true },
    data: { type: Schema.Types.Mixed, required: true },
    localizedData: { type: Schema.Types.Mixed },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    changedAt: { type: Date, default: Date.now },
    changeNote: String,
    status: { type: String, enum: ['draft', 'published', 'scheduled', 'archived'] },
  },
  { _id: false }
);

const ContentSchema = new Schema<IContent>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    
    type: {
      type: String,
      required: true,
      enum: Object.values(ContentTypes),
      index: true,
    },
    
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    
    slug: {
      type: String,
      trim: true,
      lowercase: true,
    },
    
    // Schema-based content (NEW)
    contentTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'ContentType',
      index: true,
    },
    
    contentTypeApiId: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    
    status: {
      type: String,
      enum: ['draft', 'published', 'scheduled', 'archived'],
      default: 'draft',
      index: true,
    },
    
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    
    visibility: {
      type: String,
      enum: ['public', 'private', 'password'],
      default: 'public',
    },
    
    password: {
      type: String,
      select: false,
    },
    
    data: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
    
    locale: {
      type: String,
      default: 'en',
    },
    
    localizedData: {
      type: Schema.Types.Mixed,
    },
    
    meta: {
      page: String,
      section: String,
      order: { type: Number, default: 0 },
      featured: { type: Boolean, default: false },
      pinned: { type: Boolean, default: false },
      publishedAt: Date,
      scheduledAt: Date,
      expiresAt: Date,
      author: { type: Schema.Types.ObjectId, ref: 'User' },
      category: String,
      tags: [String],
      readTime: Number,
    },
    
    seo: {
      metaTitle: String,
      metaDescription: String,
      ogImage: {
        url: String,
        alt: String,
      },
      noIndex: { type: Boolean, default: false },
      noFollow: { type: Boolean, default: false },
      canonicalUrl: String,
    },
    
    // Relationships (NEW)
    relationships: {
      type: Schema.Types.Mixed,
      default: {},
    },
    
    // Scheduling (NEW)
    scheduling: {
      publishAt: Date,
      unpublishAt: Date,
      recurring: {
        pattern: String,
        endDate: Date,
      },
    },
    
    version: {
      type: Number,
      default: 1,
    },
    
    publishedVersion: Number,
    
    versionHistory: {
      type: [VersionEntrySchema],
      default: [],
      select: false,
    },
    
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    
    deletedAt: Date,
    
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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

// Compound indexes for efficient queries
ContentSchema.index({ projectId: 1, type: 1, isDeleted: 1 });
ContentSchema.index({ projectId: 1, type: 1, isDefault: 1, isDeleted: 1 });
ContentSchema.index({ projectId: 1, type: 1, status: 1, isDeleted: 1 });
ContentSchema.index({ projectId: 1, slug: 1 }, { unique: true, sparse: true });
ContentSchema.index({ projectId: 1, type: 1, 'meta.category': 1 });
ContentSchema.index({ projectId: 1, type: 1, 'meta.tags': 1 });
ContentSchema.index({ projectId: 1, status: 1, 'meta.publishedAt': -1 });

// Virtual mapping for publishedAt to meta.publishedAt
ContentSchema.virtual('publishedAt')
  .get(function () {
    return this.meta?.publishedAt;
  })
  .set(function (this: any, val: Date) {
    if (!this.meta) {
      this.meta = {};
    }
    this.meta.publishedAt = val;
  });

ContentSchema.set('toJSON', { virtuals: true });
ContentSchema.set('toObject', { virtuals: true });

// Pre-save middleware
ContentSchema.pre('save', async function (next) {
  // ── XSS Protection ──────────────────────────────────────────────────────────
  // Sanitize the flexible data field to strip any injected scripts.
  if (this.isModified('data') && this.data) {
    try {
      this.data = sanitizeContentData(this.data as Record<string, any>);
    } catch (err) {
      console.warn('[Content] Sanitization failed, proceeding without sanitization:', err);
    }
  }

  // ── Slug Generation ─────────────────────────────────────────────────────────
  if (!this.slug && ['blog', 'page'].includes(this.type)) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  
  // If setting as default, unset other defaults of same type
  if (this.isModified('isDefault') && this.isDefault) {
    await mongoose.model('Content').updateMany(
      {
        projectId: this.projectId,
        type: this.type,
        _id: { $ne: this._id },
        isDeleted: false,
      },
      { isDefault: false }
    );
  }
  
  next();
});

// Static method to get default content
ContentSchema.statics.getDefault = async function(
  projectId: Types.ObjectId,
  type: ContentType
): Promise<IContent | null> {
  return this.findOne({
    projectId,
    type,
    isDefault: true,
    status: 'published',
    isDeleted: false,
  });
};

// Static method to set content as default
ContentSchema.statics.setAsDefault = async function(
  contentId: Types.ObjectId
): Promise<IContent | null> {
  const content = await this.findById(contentId);
  if (!content) return null;
  
  // Unset other defaults
  await this.updateMany(
    {
      projectId: content.projectId,
      type: content.type,
      _id: { $ne: contentId },
      isDeleted: false,
    },
    { isDefault: false }
  );
  
  // Set this as default
  content.isDefault = true;
  await content.save();
  
  return content;
};

// Instance method to publish
ContentSchema.methods.publish = async function(): Promise<IContent> {
  this.status = 'published';
  this.meta.publishedAt = new Date();
  this.publishedVersion = this.version;
  return this.save();
};

// Instance method to unpublish
ContentSchema.methods.unpublish = async function(): Promise<IContent> {
  this.status = 'draft';
  return this.save();
};

// Instance method to save version
ContentSchema.methods.saveVersion = async function(
  changedBy: Types.ObjectId,
  changeNote?: string
): Promise<void> {
  // versionHistory is select:false — docs loaded without it (e.g. update
  // flows) would otherwise throw on push. Treat missing as empty.
  if (!Array.isArray(this.versionHistory)) {
    this.versionHistory = [];
  }
  this.versionHistory.push({
    version: this.version,
    data: this.data,
    localizedData: this.localizedData,
    changedBy,
    changedAt: new Date(),
    changeNote,
    status: this.status,
  });
  
  // Keep only last 50 versions
  if (this.versionHistory.length > 50) {
    this.versionHistory = this.versionHistory.slice(-50);
  }
  
  this.version += 1;
};

// Instance method to populate relationships
ContentSchema.methods.populateRelationships = async function(this: any): Promise<IContent> {
  if (!this.relationships || Object.keys(this.relationships).length === 0) {
    return this as IContent;
  }

  const populated = await this.populate(
    Object.keys(this.relationships).map((fieldName: string) => ({
      path: `relationships.${fieldName}`,
      model: 'Content',
      select: '_id name slug type status data',
    }))
  );

  return populated as IContent;
};

export const Content = mongoose.model<IContent>('Content', ContentSchema);
