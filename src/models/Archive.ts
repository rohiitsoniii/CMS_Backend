import mongoose, { Schema, Document } from 'mongoose';

export interface IArchive extends Document {
  projectId: mongoose.Types.ObjectId;
  contentId: mongoose.Types.ObjectId;
  contentData: any;
  archivedBy: mongoose.Types.ObjectId;
  archivedAt: Date;
  reason?: string;
  metadata: {
    contentTypeName: string;
    title: string;
    originalPublishedAt?: Date;
  };
}

const ArchiveSchema = new Schema<IArchive>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  contentId: { type: Schema.Types.ObjectId, required: true },
  contentData: { type: Schema.Types.Mixed, required: true },
  archivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  archivedAt: { type: Date, default: Date.now },
  reason: String,
  metadata: {
    contentTypeName: { type: String, required: true },
    title: String,
    originalPublishedAt: Date
  }
}, { timestamps: true });

ArchiveSchema.index({ projectId: 1, archivedAt: -1 });
ArchiveSchema.index({ contentId: 1 });

export const Archive = mongoose.model<IArchive>('Archive', ArchiveSchema);
