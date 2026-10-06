import mongoose, { Schema, Document } from 'mongoose';

export interface ITrash extends Document {
  projectId: mongoose.Types.ObjectId;
  itemType: 'content' | 'media' | 'contentType';
  itemId: mongoose.Types.ObjectId;
  itemData: any;
  deletedBy: mongoose.Types.ObjectId;
  deletedAt: Date;
  purgeAt: Date;
  metadata: {
    originalPath?: string;
    contentTypeName?: string;
    title?: string;
  };
}

const TrashSchema = new Schema<ITrash>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  itemType: { type: String, enum: ['content', 'media', 'contentType'], required: true },
  itemId: { type: Schema.Types.ObjectId, required: true },
  itemData: { type: Schema.Types.Mixed, required: true },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deletedAt: { type: Date, default: Date.now },
  purgeAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, // 30 days
  metadata: {
    originalPath: String,
    contentTypeName: String,
    title: String
  }
}, { timestamps: true });

TrashSchema.index({ purgeAt: 1 });
TrashSchema.index({ projectId: 1, deletedAt: -1 });

export const Trash = mongoose.model<ITrash>('Trash', TrashSchema);
