import mongoose, { Document, Schema } from 'mongoose';

export interface IAuditLog extends Document {
  tenantId: mongoose.Types.ObjectId;
  actor: {
    userId?: mongoose.Types.ObjectId;
    type: 'user' | 'system' | 'api_key';
    name: string;
    email?: string;
  };
  action: string;
  resource: {
    type: string;
    id: string; // Storing as string to support diverse IDs or deleted resources
    name?: string;
  };
  metadata?: Record<string, any>;
  ip?: string;
  userAgent?: string;
  status: 'success' | 'failure';
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    actor: {
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
      type: {
        type: String,
        enum: ['user', 'system', 'api_key'],
        required: true,
      },
      name: { type: String, required: true },
      email: String,
    },
    action: {
      type: String,
      required: true,
      index: true, // Useful for filtering by action type
    },
    resource: {
      type: { type: String, required: true }, // e.g., 'Content', 'Project', 'User'
      id: { type: String, required: true },
      name: String,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
    ip: String,
    userAgent: String,
    status: {
      type: String,
      enum: ['success', 'failure'],
      default: 'success',
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Only createdAt is needed
  }
);

// Indexes for common queries
AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
AuditLogSchema.index({ 'resource.id': 1 }); // To find history of a specific item
AuditLogSchema.index({ 'actor.userId': 1 }); // To find actions by specific user

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
