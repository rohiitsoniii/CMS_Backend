import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ISeoIssue {
  type: 'error' | 'warning' | 'info';
  message: string;
  field: string;
  recommendation?: string;
}

export interface ISeoReport extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  contentId: Types.ObjectId;
  tenantId: Types.ObjectId;
  score: number;
  issues: ISeoIssue[];
  focusKeywords: string[];
  readabilityScore: number;
  analyzedAt: Date;
}

const SeoIssueSchema = new Schema<ISeoIssue>({
  type: { type: String, enum: ['error', 'warning', 'info'], required: true },
  message: { type: String, required: true },
  field: { type: String, required: true },
  recommendation: String,
}, { _id: false });

const SeoReportSchema = new Schema<ISeoReport>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    contentId: { type: Schema.Types.ObjectId, ref: 'Content', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    issues: [SeoIssueSchema],
    focusKeywords: [String],
    readabilityScore: { type: Number, default: 0 },
    analyzedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Ensure only one report per content entry exists
SeoReportSchema.index({ contentId: 1 }, { unique: true });

export const SeoReport = mongoose.model<ISeoReport>('SeoReport', SeoReportSchema);
