import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Enhanced Media Asset Model
 * Advanced media management with transformations and metadata
 */

export interface IImageTransformation {
  name: string; // e.g., 'thumbnail', 'medium', 'large'
  width?: number;
  height?: number;
  format?: 'jpeg' | 'png' | 'webp' | 'avif';
  quality?: number;
  url: string;
  size: number;
  createdAt: Date;
}

export interface IVideoMetadata {
  duration: number; // in seconds
  width: number;
  height: number;
  codec: string;
  bitrate: number;
  fps: number;
  hasAudio: boolean;
  thumbnailUrl?: string;
  previewUrl?: string; // GIF preview
}

export interface IImageMetadata {
  width: number;
  height: number;
  format: string;
  colorSpace?: string;
  hasAlpha: boolean;
  orientation?: number;
  dpi?: number;
}

export interface IAssetMetadata {
  exif?: any; // EXIF data for images
  iptc?: any; // IPTC data
  xmp?: any; // XMP data
  custom?: { [key: string]: any }; // Custom metadata
}

export interface IMediaAsset extends Document {
  tenantId: mongoose.Types.ObjectId;
  
  // Basic info
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number; // in bytes
  
  // Storage
  storageProvider: 'local' | 's3' | 'cloudinary' | 'gcs';
  storagePath: string;
  url: string;
  
  // Type-specific
  type: 'image' | 'video' | 'audio' | 'document' | 'other';
  
  // Image-specific
  imageMetadata?: IImageMetadata;
  transformations?: IImageTransformation[];
  
  // Video-specific
  videoMetadata?: IVideoMetadata;
  
  // Organization
  folderId?: mongoose.Types.ObjectId;
  folderPath?: string; // e.g., '/images/blog'
  tags: string[];
  
  // Metadata
  title?: string;
  description?: string;
  alt?: string; // Alt text for images
  caption?: string;
  metadata?: IAssetMetadata;
  
  // SEO
  seoFilename?: string; // SEO-friendly filename
  
  // Access control
  isPublic: boolean;
  accessLevel: 'public' | 'private' | 'restricted';
  
  // CDN
  cdnUrl?: string;
  cdnEnabled: boolean;
  
  // Usage tracking
  usageCount: number;
  lastUsedAt?: Date;
  usedIn: Array<{
    contentId: mongoose.Types.ObjectId;
    contentType: string;
    field: string;
  }>;
  
  // Processing
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processingError?: string;
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  uploadedBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
}

const ImageTransformationSchema = new Schema<IImageTransformation>({
  name: {
    type: String,
    required: true
  },
  width: Number,
  height: Number,
  format: {
    type: String,
    enum: ['jpeg', 'png', 'webp', 'avif']
  },
  quality: {
    type: Number,
    min: 1,
    max: 100
  },
  url: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const VideoMetadataSchema = new Schema<IVideoMetadata>({
  duration: Number,
  width: Number,
  height: Number,
  codec: String,
  bitrate: Number,
  fps: Number,
  hasAudio: Boolean,
  thumbnailUrl: String,
  previewUrl: String
}, { _id: false });

const ImageMetadataSchema = new Schema<IImageMetadata>({
  width: Number,
  height: Number,
  format: String,
  colorSpace: String,
  hasAlpha: Boolean,
  orientation: Number,
  dpi: Number
}, { _id: false });

const MediaAssetSchema = new Schema<IMediaAsset>({
  tenantId: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  filename: {
    type: String,
    required: true,
    index: true
  },
  originalFilename: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  storageProvider: {
    type: String,
    enum: ['local', 's3', 'cloudinary', 'gcs'],
    default: 'local'
  },
  storagePath: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['image', 'video', 'audio', 'document', 'other'],
    required: true,
    index: true
  },
  imageMetadata: ImageMetadataSchema,
  transformations: [ImageTransformationSchema],
  videoMetadata: VideoMetadataSchema,
  folderId: {
    type: Schema.Types.ObjectId,
    ref: 'MediaFolder',
    index: true
  },
  folderPath: {
    type: String,
    index: true
  },
  tags: [{
    type: String,
    lowercase: true,
    trim: true,
    index: true
  }],
  title: String,
  description: String,
  alt: String,
  caption: String,
  metadata: Schema.Types.Mixed,
  seoFilename: String,
  isPublic: {
    type: Boolean,
    default: true
  },
  accessLevel: {
    type: String,
    enum: ['public', 'private', 'restricted'],
    default: 'public'
  },
  cdnUrl: String,
  cdnEnabled: {
    type: Boolean,
    default: false
  },
  usageCount: {
    type: Number,
    default: 0
  },
  lastUsedAt: Date,
  usedIn: [{
    contentId: {
      type: Schema.Types.ObjectId,
      ref: 'Content'
    },
    contentType: String,
    field: String
  }],
  processingStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  processingError: String,
  uploadedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Indexes
MediaAssetSchema.index({ tenantId: 1, type: 1 });
MediaAssetSchema.index({ tenantId: 1, folderId: 1 });
MediaAssetSchema.index({ tenantId: 1, tags: 1 });
MediaAssetSchema.index({ tenantId: 1, processingStatus: 1 });
MediaAssetSchema.index({ tenantId: 1, createdAt: -1 });

// Text search index
MediaAssetSchema.index({
  filename: 'text',
  originalFilename: 'text',
  title: 'text',
  description: 'text',
  tags: 'text'
});

// Methods
MediaAssetSchema.methods.getTransformation = function(this: any, name: string): IImageTransformation | undefined {
  return this.transformations?.find((t: IImageTransformation) => t.name === name);
};

MediaAssetSchema.methods.addTransformation = function(this: any, transformation: IImageTransformation) {
  if (!this.transformations) {
    this.transformations = [];
  }

  // Remove existing transformation with same name
  this.transformations = this.transformations.filter((t: IImageTransformation) => t.name !== transformation.name);
  
  // Add new transformation
  this.transformations.push(transformation);
};

MediaAssetSchema.methods.incrementUsage = function() {
  this.usageCount += 1;
  this.lastUsedAt = new Date();
};

MediaAssetSchema.methods.trackUsage = function(this: any, contentId: mongoose.Types.ObjectId, contentType: string, field: string) {
  // Check if already tracked
  const exists = this.usedIn.some(
    (u: { contentId: mongoose.Types.ObjectId; field: string }) => u.contentId.toString() === contentId.toString() && u.field === field
  );
  
  if (!exists) {
    this.usedIn.push({ contentId, contentType, field });
    this.incrementUsage();
  }
};

MediaAssetSchema.methods.removeUsage = function(this: any, contentId: mongoose.Types.ObjectId, field: string) {
  this.usedIn = this.usedIn.filter(
    (u: { contentId: mongoose.Types.ObjectId; field: string }) => !(u.contentId.toString() === contentId.toString() && u.field === field)
  );
  
  if (this.usageCount > 0) {
    this.usageCount -= 1;
  }
};

MediaAssetSchema.methods.isImage = function(): boolean {
  return this.type === 'image';
};

MediaAssetSchema.methods.isVideo = function(): boolean {
  return this.type === 'video';
};

MediaAssetSchema.methods.getPublicUrl = function(): string {
  return this.cdnEnabled && this.cdnUrl ? this.cdnUrl : this.url;
};

// Static methods
MediaAssetSchema.statics.findByTenant = function(tenantId: mongoose.Types.ObjectId, type?: string) {
  const query: any = { tenantId };
  if (type) {
    query.type = type;
  }
  return this.find(query).sort({ createdAt: -1 });
};

MediaAssetSchema.statics.findByFolder = function(folderId: mongoose.Types.ObjectId) {
  return this.find({ folderId }).sort({ createdAt: -1 });
};

MediaAssetSchema.statics.findByTags = function(tenantId: mongoose.Types.ObjectId, tags: string[]) {
  return this.find({
    tenantId,
    tags: { $in: tags }
  }).sort({ createdAt: -1 });
};

MediaAssetSchema.statics.search = function(tenantId: mongoose.Types.ObjectId, searchTerm: string) {
  return this.find({
    tenantId,
    $text: { $search: searchTerm }
  }, {
    score: { $meta: 'textScore' }
  }).sort({ score: { $meta: 'textScore' } });
};

MediaAssetSchema.statics.findUnused = function(tenantId: mongoose.Types.ObjectId) {
  return this.find({
    tenantId,
    usageCount: 0
  }).sort({ createdAt: -1 });
};

MediaAssetSchema.statics.getTotalSize = async function(tenantId: mongoose.Types.ObjectId): Promise<number> {
  const result = await this.aggregate([
    { $match: { tenantId } },
    { $group: { _id: null, totalSize: { $sum: '$size' } } }
  ]);
  
  return result.length > 0 ? result[0].totalSize : 0;
};

const MediaAsset: Model<IMediaAsset> = mongoose.model<IMediaAsset>('MediaAsset', MediaAssetSchema);

export default MediaAsset;
