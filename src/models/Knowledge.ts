import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Knowledge Base Model
 * 
 * Stores Q&A pairs for AI chatbot training.
 * Users add questions and answers, and the chatbot learns from them.
 */

export interface IKnowledge extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  tenantId: Types.ObjectId;
  
  // Q&A Content
  question: string;
  answer: string;
  
  // Organization
  category: string;
  keywords: string[];
  
  // RAG Source tracking
  sourceType: 'manual' | 'document' | 'url' | 'cms_content';
  sourceUrl?: string;
  sourceFile?: string;
  chunkIndex?: number;
  contentHash?: string;
  characterCount?: number;
  
  // Vector search
  embedding?: number[];
  
  // AI Training
  variations?: string[];
  intent?: string;
  followUp?: {
    question: string;
    action: string;
  };
  
  // Rich answer (optional)
  richAnswer?: {
    format: 'text' | 'html' | 'markdown';
    content: string;
    media?: {
      type: 'image' | 'video' | 'link';
      url: string;
      title?: string;
    }[];
    buttons?: {
      label: string;
      action: string;
      url?: string;
    }[];
  };
  
  // Metrics
  metrics: {
    usageCount: number;
    helpfulCount: number;
    notHelpfulCount: number;
    lastUsedAt?: Date;
  };
  
  // Status
  status: 'active' | 'inactive' | 'draft';
  priority: number;
  
  // Audit
  createdAt: Date;
  createdBy: Types.ObjectId;
  updatedAt: Date;
  updatedBy?: Types.ObjectId;
}

const KnowledgeSchema = new Schema<IKnowledge>(
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
      index: true,
    },
    
    question: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    
    answer: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    
    category: {
      type: String,
      required: true,
      trim: true,
      default: 'general',
    },
    
    keywords: {
      type: [String],
      default: [],
      index: true,
    },
    
    sourceType: {
      type: String,
      enum: ['manual', 'document', 'url', 'cms_content'],
      default: 'manual',
      required: true,
      index: true,
    },
    
    sourceUrl: String,
    sourceFile: String,
    
    chunkIndex: {
      type: Number,
      index: true,
    },
    
    contentHash: {
      type: String,
      index: true,
    },
    
    characterCount: Number,
    
    embedding: {
      type: [Number],
      default: [],
    },
    
    variations: {
      type: [String],
      default: [],
    },
    
    intent: {
      type: String,
      trim: true,
    },
    
    followUp: {
      question: String,
      action: String,
    },
    
    richAnswer: {
      format: {
        type: String,
        enum: ['text', 'html', 'markdown'],
        default: 'text',
      },
      content: String,
      media: [{
        type: { type: String, enum: ['image', 'video', 'link'] },
        url: String,
        title: String,
      }],
      buttons: [{
        label: String,
        action: String,
        url: String,
      }],
    },
    
    metrics: {
      usageCount: { type: Number, default: 0 },
      helpfulCount: { type: Number, default: 0 },
      notHelpfulCount: { type: Number, default: 0 },
      lastUsedAt: Date,
    },
    
    status: {
      type: String,
      enum: ['active', 'inactive', 'draft'],
      default: 'active',
      index: true,
    },
    
    priority: {
      type: Number,
      default: 0,
    },
    
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
KnowledgeSchema.index({ projectId: 1, status: 1 });
KnowledgeSchema.index({ projectId: 1, category: 1, status: 1 });
KnowledgeSchema.index({ projectId: 1, keywords: 1, status: 1 });

// Text index for searching
KnowledgeSchema.index(
  { question: 'text', answer: 'text', keywords: 'text', variations: 'text' },
  { weights: { question: 10, keywords: 5, variations: 5, answer: 1 } }
);

// Static method to find matching Q&A
KnowledgeSchema.statics.findMatch = async function(
  projectId: Types.ObjectId,
  query: string
): Promise<IKnowledge[]> {
  return this.find(
    {
      projectId,
      status: 'active',
      $text: { $search: query },
    },
    { score: { $meta: 'textScore' } }
  )
    .sort({ score: { $meta: 'textScore' }, priority: -1 })
    .limit(5);
};

// Instance method to record usage
KnowledgeSchema.methods.recordUsage = async function(helpful?: boolean): Promise<void> {
  this.metrics.usageCount += 1;
  this.metrics.lastUsedAt = new Date();
  
  if (helpful === true) {
    this.metrics.helpfulCount += 1;
  } else if (helpful === false) {
    this.metrics.notHelpfulCount += 1;
  }
  
  await this.save();
};

export const Knowledge = mongoose.model<IKnowledge>('Knowledge', KnowledgeSchema);
