import mongoose, { Schema, Document } from 'mongoose';

export interface IDeploymentIntegration extends Document {
  tenantId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  provider: 'vercel' | 'netlify' | 'custom';
  name: string;
  hookUrl: string;
  hookSecret?: string;
  lastDeployAt?: Date;
  lastDeployStatus?: 'success' | 'failed' | 'pending';
  createdAt: Date;
  updatedAt: Date;
}

const DeploymentIntegrationSchema = new Schema<IDeploymentIntegration>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  provider: { type: String, enum: ['vercel', 'netlify', 'custom'], required: true },
  name: { type: String, required: true },
  hookUrl: { type: String, required: true },
  hookSecret: { type: String },
  lastDeployAt: { type: Date },
  lastDeployStatus: { type: String, enum: ['success', 'failed', 'pending'] }
}, {
  timestamps: true
});

DeploymentIntegrationSchema.index({ tenantId: 1, projectId: 1 });

const DeploymentIntegration = mongoose.model<IDeploymentIntegration>('DeploymentIntegration', DeploymentIntegrationSchema);

export default DeploymentIntegration;
