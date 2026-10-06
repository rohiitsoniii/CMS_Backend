import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IKeywordRank extends Document {
  projectId: Types.ObjectId;
  tenantId: Types.ObjectId;
  keyword: string;
  targetUrl?: string;
  targetContentId?: Types.ObjectId;
  currentRank: number;
  bestRank: number;
  rankHistory: Array<{
    rank: number;
    checkedAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const KeywordRankSchema = new Schema<IKeywordRank>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    keyword: {
      type: String,
      required: true,
      trim: true,
    },
    targetUrl: {
      type: String,
      trim: true,
    },
    targetContentId: {
      type: Schema.Types.ObjectId,
      ref: 'Content',
    },
    currentRank: {
      type: Number,
      default: 0,
    },
    bestRank: {
      type: Number,
      default: 0,
    },
    rankHistory: [
      {
        rank: { type: Number, default: 0 },
        checkedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

KeywordRankSchema.index({ projectId: 1, keyword: 1 });

export const KeywordRank = mongoose.model<IKeywordRank>('KeywordRank', KeywordRankSchema);
export default KeywordRank;
