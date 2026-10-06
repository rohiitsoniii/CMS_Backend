import mongoose, { Document, Schema } from 'mongoose';

export interface IMediaFile extends Document {
  _id: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number; // bytes
  storageType: 'gridfs' | 's3';
  storageKey: string; // GridFS fileId or S3 key
  url: string; // Public URL (CDN or direct)
  thumbnailUrl?: string;
  dimensions?: {
    width: number;
    height: number;
  };
  alt?: string;
  caption?: string;
  folder?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  isPublic: boolean;
  uploadedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const mediaFileSchema = new Schema<IMediaFile>({
  tenantId: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: [true, 'Tenant ID is required'],
    index: true,
  },
  filename: {
    type: String,
    required: true,
    trim: true,
  },
  originalName: {
    type: String,
    required: true,
    trim: true,
  },
  mimeType: {
    type: String,
    required: true,
  },
  size: {
    type: Number,
    required: true,
  },
  storageType: {
    type: String,
    enum: ['gridfs', 's3'],
    default: 'gridfs',
  },
  storageKey: {
    type: String,
    required: true,
  },
  url: {
    type: String,
    required: true,
  },
  thumbnailUrl: String,
  dimensions: {
    width: Number,
    height: Number,
  },
  alt: {
    type: String,
    trim: true,
    maxlength: [500, 'Alt text cannot exceed 500 characters'],
  },
  caption: {
    type: String,
    trim: true,
    maxlength: [1000, 'Caption cannot exceed 1000 characters'],
  },
  folder: {
    type: String,
    trim: true,
    lowercase: true,
    default: 'uploads',
  },
  tags: [{ type: String, trim: true, lowercase: true }],
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
  isPublic: {
    type: Boolean,
    default: true,
  },
  uploadedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

// Indexes
mediaFileSchema.index({ tenantId: 1, folder: 1 });
mediaFileSchema.index({ tenantId: 1, mimeType: 1 });
mediaFileSchema.index({ tenantId: 1, tags: 1 });
mediaFileSchema.index({ tenantId: 1, createdAt: -1 });

// Virtual for file type category
mediaFileSchema.virtual('fileType').get(function() {
  if (this.mimeType.startsWith('image/')) return 'image';
  if (this.mimeType.startsWith('video/')) return 'video';
  if (this.mimeType.startsWith('audio/')) return 'audio';
  if (this.mimeType === 'application/pdf') return 'pdf';
  return 'document';
});

// Virtual for human-readable size
mediaFileSchema.virtual('humanSize').get(function() {
  const bytes = this.size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
});

mediaFileSchema.set('toJSON', { virtuals: true });
mediaFileSchema.set('toObject', { virtuals: true });

export const MediaFile = mongoose.model<IMediaFile>('MediaFile', mediaFileSchema);
