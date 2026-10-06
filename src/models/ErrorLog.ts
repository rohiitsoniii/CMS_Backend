import mongoose, { Document, Schema } from 'mongoose';

export interface IErrorLog extends Document {
  message: string;
  stack?: string;
  statusCode: number;
  userId?: mongoose.Types.ObjectId;
  tenantId?: mongoose.Types.ObjectId;
  path: string;
  method: string;
  requestId?: string;
  params?: Record<string, any>;
  body?: any;
  severity: 'low' | 'medium' | 'high' | 'critical';
  isOperational: boolean;
  metadata?: Record<string, any>;
  isFixed: boolean;
  fixedBy?: mongoose.Types.ObjectId;
  fixedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ErrorLogSchema = new Schema<IErrorLog>({
  message: { type: String, required: true },
  stack: String,
  statusCode: { type: Number, default: 500 },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
  path: { type: String, required: true },
  method: { type: String, required: true },
  requestId: { type: String },
  params: Schema.Types.Mixed,
  body: Schema.Types.Mixed,
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  isOperational: { type: Boolean, default: false },
  metadata: Schema.Types.Mixed,
  isFixed: { type: Boolean, default: false },
  fixedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  fixedAt: Date,
}, {
  timestamps: true
});

ErrorLogSchema.index({ statusCode: 1 });
ErrorLogSchema.index({ severity: 1 });
ErrorLogSchema.index({ tenantId: 1, createdAt: -1 });
ErrorLogSchema.index({ isFixed: 1 });

export const ErrorLog = mongoose.model<IErrorLog>('ErrorLog', ErrorLogSchema);
