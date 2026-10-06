import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Media Folder Model
 * Organize media assets in folders
 */

export interface IMediaFolder extends Document {
  tenantId: mongoose.Types.ObjectId;
  
  // Folder info
  name: string;
  slug: string;
  description?: string;
  
  // Hierarchy
  parentId?: mongoose.Types.ObjectId;
  path: string; // e.g., '/images/blog'
  level: number; // 0 for root, 1 for first level, etc.
  
  // Permissions
  isPublic: boolean;
  accessLevel: 'public' | 'private' | 'restricted';
  
  // Stats
  assetCount: number;
  totalSize: number; // in bytes
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
}

const MediaFolderSchema = new Schema<IMediaFolder>({
  tenantId: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  parentId: {
    type: Schema.Types.ObjectId,
    ref: 'MediaFolder',
    index: true
  },
  path: {
    type: String,
    required: true,
    index: true
  },
  level: {
    type: Number,
    required: true,
    default: 0
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  accessLevel: {
    type: String,
    enum: ['public', 'private', 'restricted'],
    default: 'public'
  },
  assetCount: {
    type: Number,
    default: 0
  },
  totalSize: {
    type: Number,
    default: 0
  },
  createdBy: {
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
MediaFolderSchema.index({ tenantId: 1, parentId: 1 });
MediaFolderSchema.index({ tenantId: 1, path: 1 }, { unique: true });
MediaFolderSchema.index({ tenantId: 1, slug: 1 });

// Methods
MediaFolderSchema.methods.getFullPath = function(): string {
  return this.path;
};

MediaFolderSchema.methods.isRoot = function(): boolean {
  return this.level === 0 && !this.parentId;
};

MediaFolderSchema.methods.hasChildren = async function(): Promise<boolean> {
  const count = await this.constructor.countDocuments({ parentId: this._id });
  return count > 0;
};

MediaFolderSchema.methods.getChildren = function() {
  return this.constructor.find({ parentId: this._id }).sort({ name: 1 });
};

MediaFolderSchema.methods.getAncestors = async function(): Promise<IMediaFolder[]> {
  const ancestors: IMediaFolder[] = [];
  let current = this;
  
  while (current.parentId) {
    const parent = await this.constructor.findById(current.parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }
  
  return ancestors;
};

// Static methods
MediaFolderSchema.statics.findByTenant = function(tenantId: mongoose.Types.ObjectId) {
  return this.find({ tenantId }).sort({ path: 1 });
};

MediaFolderSchema.statics.findRootFolders = function(tenantId: mongoose.Types.ObjectId) {
  return this.find({
    tenantId,
    level: 0,
    parentId: { $exists: false }
  }).sort({ name: 1 });
};

MediaFolderSchema.statics.findByPath = function(tenantId: mongoose.Types.ObjectId, path: string) {
  return this.findOne({ tenantId, path });
};

MediaFolderSchema.statics.buildPath = async function(parentId?: mongoose.Types.ObjectId, slug?: string): Promise<string> {
  if (!parentId) {
    return `/${slug || ''}`;
  }
  
  const parent = await this.findById(parentId);
  if (!parent) {
    throw new Error('Parent folder not found');
  }
  
  return `${parent.path}/${slug || ''}`;
};

// Pre-save middleware
MediaFolderSchema.pre('save', async function(next) {
  // Build path if not set
  if (!this.path && this.slug) {
    this.path = await (this.constructor as any).buildPath(this.parentId, this.slug);
  }
  
  // Set level based on parent
  if (this.parentId) {
    const parent = await this.constructor.findById(this.parentId);
    if (parent) {
      this.level = (parent as any).level + 1;
    }
  } else {
    this.level = 0;
  }
  
  next();
});

// Pre-remove middleware
MediaFolderSchema.pre('deleteOne', { document: true, query: false }, async function(next) {
  // Check if folder has children
  const hasChildren = await this.hasChildren();
  if (hasChildren) {
    throw new Error('Cannot delete folder with children');
  }
  
  // Check if folder has assets
  const MediaAsset = mongoose.model('MediaAsset');
  const assetCount = await MediaAsset.countDocuments({ folderId: this._id });
  if (assetCount > 0) {
    throw new Error('Cannot delete folder with assets');
  }
  
  next();
});

const MediaFolder: Model<IMediaFolder> = mongoose.model<IMediaFolder>('MediaFolder', MediaFolderSchema);

export default MediaFolder;
