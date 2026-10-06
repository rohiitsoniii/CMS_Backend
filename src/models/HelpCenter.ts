import mongoose, { Document, Schema } from 'mongoose';

export interface IHelpArticle extends Document {
  title: string;
  slug: string;
  content: string;
  category: string;
  tags: string[];
  author: mongoose.Types.ObjectId;
  isPublished: boolean;
  isFeatured: boolean;
  viewCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IHelpCategory extends Document {
  name: string;
  slug: string;
  description: string;
  icon: string;
  order: number;
  articleCount: number;
}

const helpArticleSchema = new Schema<IHelpArticle>({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  content: { type: String, required: true },
  category: { type: String, required: true },
  tags: [String],
  author: { type: Schema.Types.ObjectId, ref: 'User' },
  isPublished: { type: Boolean, default: false },
  isFeatured: { type: Boolean, default: false },
  viewCount: { type: Number, default: 0 },
  helpfulCount: { type: Number, default: 0 },
  notHelpfulCount: { type: Number, default: 0 }
}, { timestamps: true });

helpArticleSchema.index({ title: 'text', content: 'text', tags: 'text' });

export const HelpArticle = mongoose.model<IHelpArticle>('HelpArticle', helpArticleSchema);

const helpCategorySchema = new Schema<IHelpCategory>({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: String,
  icon: String,
  order: { type: Number, default: 0 },
  articleCount: { type: Number, default: 0 }
});

export const HelpCategory = mongoose.model<IHelpCategory>('HelpCategory', helpCategorySchema);