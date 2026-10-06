import mongoose, { Document, Schema } from 'mongoose';

export interface IEnvVariable extends Document {
  tenantId: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  key: string;
  value: string;
  isSecret: boolean;
  description?: string;
  category: 'api' | 'database' | 'auth' | 'integration' | 'custom';
  environment: 'development' | 'staging' | 'production' | 'all';
  createdAt: Date;
  updatedAt: Date;
  createdBy: mongoose.Types.ObjectId;
}

const envVariableSchema = new Schema<IEnvVariable>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
  key: { type: String, required: true, trim: true },
  value: { type: String, required: true },
  isSecret: { type: Boolean, default: false },
  description: { type: String, trim: true },
  category: {
    type: String,
    enum: ['api', 'database', 'auth', 'integration', 'custom'],
    default: 'custom'
  },
  environment: {
    type: String,
    enum: ['development', 'staging', 'production', 'all'],
    default: 'all'
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

envVariableSchema.index({ tenantId: 1, key: 1 }, { unique: true });
envVariableSchema.index({ tenantId: 1, category: 1 });

export const EnvVariable = mongoose.model<IEnvVariable>('EnvVariable', envVariableSchema);