import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAuditIssue {
  url: string;
  type: 'error' | 'warning' | 'info';
  category: 'links' | 'meta' | 'content' | 'images' | 'performance' | 'security' | 'accessibility';
  message: string;
  field?: string;
  recommendation?: string;
  impact: 'high' | 'medium' | 'low';
}

export interface ISeoAuditReport extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  tenantId: Types.ObjectId;
  
  status: 'pending' | 'crawling' | 'completed' | 'failed';
  totalUrlsScanned: number;
  healthScore: number;
  
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  
  issues: IAuditIssue[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

const AuditIssueSchema = new Schema<IAuditIssue>({
  url: { type: String, required: true },
  type: { type: String, enum: ['error', 'warning', 'info'], required: true },
  category: { type: String, enum: ['links', 'meta', 'content', 'images', 'performance', 'security', 'accessibility'], required: true },
  message: { type: String, required: true },
  field: String,
  recommendation: String,
  impact: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
}, { _id: false });

const SeoAuditReportSchema = new Schema<ISeoAuditReport>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    status: { type: String, enum: ['pending', 'crawling', 'completed', 'failed'], default: 'pending' },
    totalUrlsScanned: { type: Number, default: 0 },
    healthScore: { type: Number, default: 0 },
    summary: {
      errors: { type: Number, default: 0 },
      warnings: { type: Number, default: 0 },
      info: { type: Number, default: 0 },
    },
    issues: [AuditIssueSchema],
    startedAt: { type: Date, default: Date.now },
    completedAt: Date,
    error: String,
  },
  { timestamps: true }
);

export const SeoAuditReport = mongoose.model<ISeoAuditReport>('SeoAuditReport', SeoAuditReportSchema);
