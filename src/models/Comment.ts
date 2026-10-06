import mongoose, { Schema, Document } from 'mongoose';

export interface IComment extends Document {
  projectId: mongoose.Types.ObjectId;
  contentId: mongoose.Types.ObjectId;
  fieldPath?: string;
  author: mongoose.Types.ObjectId;
  content: string;
  mentions: mongoose.Types.ObjectId[];
  parentId?: mongoose.Types.ObjectId;
  resolved: boolean;
  resolvedBy?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CommentSchema = new Schema<IComment>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  contentId: { type: Schema.Types.ObjectId, ref: 'Content', required: true, index: true },
  fieldPath: { type: String },
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  mentions: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  parentId: { type: Schema.Types.ObjectId, ref: 'Comment' },
  resolved: { type: Boolean, default: false },
  resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: { type: Date }
}, { timestamps: true });

CommentSchema.index({ contentId: 1, createdAt: -1 });
CommentSchema.index({ projectId: 1, resolved: 1 });

export const Comment = mongoose.model<IComment>('Comment', CommentSchema);
