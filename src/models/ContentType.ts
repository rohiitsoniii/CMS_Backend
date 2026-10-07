import mongoose, { Schema, Document, Model } from 'mongoose';
import { IFieldDefinition } from '../types/fieldTypes';

/**
 * ContentType Model
 * Defines the schema for user-created content types
 */

export interface IContentType extends Document {
  tenantId: mongoose.Types.ObjectId;
  apiId: string; // Used in API URLs (e.g., "blogPost")
  name: string; // Display name (e.g., "Blog Post")
  description?: string;
  
  // Configuration
  displayField: string; // Field to show in lists
  previewUrl?: string; // URL pattern for previews
  
  // Fields
  fields: IFieldDefinition[];
  
  // Meta
  isSystem: boolean; // System types can't be deleted
  icon?: string; // Icon for UI
  category?: string; // Group in UI
  
  // Audit
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FieldDefinitionSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  displayName: { type: String, required: true },
  type: { type: String, required: true },
  required: { type: Boolean, default: false },
  localized: { type: Boolean, default: false },
  unique: { type: Boolean, default: false },
  hidden: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  config: { type: Schema.Types.Mixed, default: {} },
  defaultValue: { type: Schema.Types.Mixed },
  helpText: { type: String },
  appearance: { type: String },
  position: { type: Number, required: true },
}, { _id: false });

const ContentTypeSchema = new Schema<IContentType>({
  tenantId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Tenant', 
    required: true,
    index: true 
  },
  apiId: { 
    type: String, 
    required: true,
    lowercase: true,
    trim: true,
    match: /^[a-z][a-zA-Z0-9]*$/ // Must start with lowercase letter
  },
  name: { 
    type: String, 
    required: true,
    trim: true 
  },
  description: { 
    type: String,
    trim: true 
  },
  displayField: { 
    type: String, 
    required: true 
  },
  previewUrl: { 
    type: String 
  },
  fields: { 
    type: [FieldDefinitionSchema], 
    required: true,
    validate: {
      validator: function(fields: IFieldDefinition[]) {
        return fields.length > 0;
      },
      message: 'Content type must have at least one field'
    }
  },
  isSystem: { 
    type: Boolean, 
    default: false 
  },
  icon: { 
    type: String 
  },
  category: { 
    type: String 
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
  },
}, {
  timestamps: true,
});

// Indexes
ContentTypeSchema.index({ tenantId: 1, apiId: 1 }, { unique: true });
ContentTypeSchema.index({ tenantId: 1, name: 1 });
ContentTypeSchema.index({ createdAt: -1 });

// Virtual for field count
ContentTypeSchema.virtual('fieldCount').get(function() {
  return this.fields.length;
});

// Methods
ContentTypeSchema.methods.getField = function(this: any, fieldName: string): IFieldDefinition | undefined {
  return this.fields.find((f: IFieldDefinition) => f.name === fieldName);
};

ContentTypeSchema.methods.hasField = function(this: any, fieldName: string): boolean {
  return this.fields.some((f: IFieldDefinition) => f.name === fieldName);
};

ContentTypeSchema.methods.getLocalizedFields = function(this: any): IFieldDefinition[] {
  return this.fields.filter((f: IFieldDefinition) => f.localized);
};

ContentTypeSchema.methods.getRequiredFields = function(this: any): IFieldDefinition[] {
  return this.fields.filter((f: IFieldDefinition) => f.required);
};

ContentTypeSchema.methods.validateFieldData = function(fieldName: string, value: any): { valid: boolean; errors: string[] } {
  const field = this.getField(fieldName);
  if (!field) {
    return { valid: false, errors: [`Field "${fieldName}" does not exist`] };
  }
  
  // Import validation logic (will be implemented in fieldValidators.ts)
  // For now, basic validation
  const errors: string[] = [];
  
  if (field.required && (value === undefined || value === null || value === '')) {
    errors.push(`${field.displayName} is required`);
  }
  
  return { valid: errors.length === 0, errors };
};

// Static methods
ContentTypeSchema.statics.findByApiId = function(tenantId: mongoose.Types.ObjectId, apiId: string) {
  return this.findOne({ tenantId, apiId });
};

ContentTypeSchema.statics.findByTenant = function(tenantId: mongoose.Types.ObjectId) {
  return this.find({ tenantId }).sort({ name: 1 });
};

ContentTypeSchema.statics.apiIdExists = async function(tenantId: mongoose.Types.ObjectId, apiId: string, excludeId?: mongoose.Types.ObjectId) {
  const query: any = { tenantId, apiId };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  const count = await this.countDocuments(query);
  return count > 0;
};

// Pre-save validation
ContentTypeSchema.pre('save', async function(next) {
  // Validate displayField exists in fields
  const hasDisplayField = this.fields.some(f => f.name === this.displayField);
  if (!hasDisplayField) {
    throw new Error(`Display field "${this.displayField}" must exist in fields`);
  }
  
  // Validate field names are unique
  const fieldNames = this.fields.map(f => f.name);
  const uniqueNames = new Set(fieldNames);
  if (fieldNames.length !== uniqueNames.size) {
    throw new Error('Field names must be unique');
  }
  
  // Validate field IDs are unique
  const fieldIds = this.fields.map(f => f.id);
  const uniqueIds = new Set(fieldIds);
  if (fieldIds.length !== uniqueIds.size) {
    throw new Error('Field IDs must be unique');
  }
  
  next();
});

// Prevent deletion of system content types
ContentTypeSchema.pre('deleteOne', { document: true, query: false }, function(next) {
  if (this.isSystem) {
    throw new Error('Cannot delete system content type');
  }
  next();
});

const ContentType: Model<IContentType> = mongoose.model<IContentType>('ContentType', ContentTypeSchema);

export default ContentType;
