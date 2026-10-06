import mongoose, { Schema, Document, Model } from 'mongoose';
import { IFieldDefinition } from '../types/fieldTypes';

/**
 * Component Model
 * Defines reusable field groups that can be used across content types
 */

export interface IComponent extends Document {
  tenantId: mongoose.Types.ObjectId;
  apiId: string; // e.g., "seoMetadata"
  name: string; // e.g., "SEO Metadata"
  description?: string;
  
  // Fields
  fields: IFieldDefinition[];
  
  // Meta
  icon?: string; // Icon for UI
  category?: string; // Group in picker (e.g., "SEO", "Social", "Address")
  singleton: boolean; // Only one instance allowed
  
  // Audit
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ComponentFieldDefinitionSchema = new Schema({
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

const ComponentSchema = new Schema<IComponent>({
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
    match: /^[a-z][a-zA-Z0-9]*$/ 
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
  fields: { 
    type: [ComponentFieldDefinitionSchema], 
    required: true,
    validate: {
      validator: function(fields: IFieldDefinition[]) {
        return fields.length > 0;
      },
      message: 'Component must have at least one field'
    }
  },
  icon: { 
    type: String 
  },
  category: { 
    type: String,
    default: 'General' 
  },
  singleton: { 
    type: Boolean, 
    default: false 
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
ComponentSchema.index({ tenantId: 1, apiId: 1 }, { unique: true });
ComponentSchema.index({ tenantId: 1, category: 1 });
ComponentSchema.index({ createdAt: -1 });

// Virtual for field count
ComponentSchema.virtual('fieldCount').get(function() {
  return this.fields.length;
});

// Methods
ComponentSchema.methods.getField = function(fieldName: string): IFieldDefinition | undefined {
  return this.fields.find(f => f.name === fieldName);
};

ComponentSchema.methods.hasField = function(fieldName: string): boolean {
  return this.fields.some(f => f.name === fieldName);
};

// Static methods
ComponentSchema.statics.findByApiId = function(tenantId: mongoose.Types.ObjectId, apiId: string) {
  return this.findOne({ tenantId, apiId });
};

ComponentSchema.statics.findByTenant = function(tenantId: mongoose.Types.ObjectId) {
  return this.find({ tenantId }).sort({ category: 1, name: 1 });
};

ComponentSchema.statics.findByCategory = function(tenantId: mongoose.Types.ObjectId, category: string) {
  return this.find({ tenantId, category }).sort({ name: 1 });
};

ComponentSchema.statics.apiIdExists = async function(tenantId: mongoose.Types.ObjectId, apiId: string, excludeId?: mongoose.Types.ObjectId) {
  const query: any = { tenantId, apiId };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  const count = await this.countDocuments(query);
  return count > 0;
};

ComponentSchema.statics.isInUse = async function(componentId: mongoose.Types.ObjectId) {
  // Check if component is used in any content type
  const ContentType = mongoose.model('ContentType');
  const count = await ContentType.countDocuments({
    'fields.type': 'component',
    'fields.config.componentId': componentId.toString()
  });
  return count > 0;
};

// Pre-save validation
ComponentSchema.pre('save', async function(next) {
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
  
  // Prevent nested components (components can't contain other components)
  const hasComponentField = this.fields.some(f => f.type === 'component');
  if (hasComponentField) {
    throw new Error('Components cannot contain other components');
  }
  
  next();
});

// Prevent deletion if component is in use
ComponentSchema.pre('deleteOne', { document: true, query: false }, async function(next) {
  const Component = mongoose.model<IComponent>('Component');
  const isUsed = await Component.isInUse(this._id);
  if (isUsed) {
    throw new Error('Cannot delete component that is in use');
  }
  next();
});

const Component: Model<IComponent> = mongoose.model<IComponent>('Component', ComponentSchema);

export default Component;
