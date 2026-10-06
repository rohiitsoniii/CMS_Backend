import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRobotsConfig extends Document {
  projectId: Types.ObjectId;
  tenantId: Types.ObjectId;
  content: string; // The raw robots.txt content
  updatedBy: Types.ObjectId;
  updatedAt: Date;
}

const RobotsConfigSchema = new Schema<IRobotsConfig>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    content: { 
      type: String, 
      default: 'User-agent: *\nAllow: /\n\nSitemap: https://yourdomain.com/sitemap.xml' 
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Ensure only one config per project
RobotsConfigSchema.index({ projectId: 1 }, { unique: true });

export const RobotsConfig = mongoose.model<IRobotsConfig>('RobotsConfig', RobotsConfigSchema);
