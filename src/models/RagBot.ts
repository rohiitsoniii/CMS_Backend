import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * RAG Bot Model
 * 
 * Represents an AI chatbot configured with personality, appearance, 
 * and retrieval settings.
 */

export interface IRagBot extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  tenantId: Types.ObjectId;
  
  name: string;
  slug: string;
  description?: string;
  
  // Personality & behavior
  persona: {
    systemPrompt: string;
    temperature: number;
    model: string;
    maxResponseTokens: number;
    language: string;
  };
  
  // Widget appearance
  widget: {
    name: string;
    avatarUrl?: string;
    primaryColor: string;
    secondaryColor: string;
    position: 'bottom-right' | 'bottom-left';
    greeting: string;
    placeholder: string;
    suggestedQuestions: string[];
    showSources: boolean;
    collectEmail: boolean;
  };
  
  // Access control
  allowedOrigins: string[];
  apiKey: string;
  
  // Retrieval settings
  retrieval: {
    topK: number;
    similarityThreshold: number;
    reranking: boolean;
  };
  
  // Stats (denormalized)
  stats: {
    totalConversations: number;
    totalMessages: number;
    avgSatisfactionScore: number;
    lastActiveAt?: Date;
  };
  
  status: 'active' | 'draft' | 'paused';
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
}

const RagBotSchema = new Schema<IRagBot>(
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
    
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    
    description: String,
    
    persona: {
      systemPrompt: {
        type: String,
        default: 'You are a helpful assistant. Use the provided context to answer questions.',
      },
      temperature: { type: Number, default: 0.7 },
      model: { type: String, default: 'meta-llama/llama-3.2-3b-instruct:free' },
      maxResponseTokens: { type: Number, default: 500 },
      language: { type: String, default: 'en' },
    },
    
    widget: {
      name: { type: String, default: 'AI Assistant' },
      avatarUrl: String,
      primaryColor: { type: String, default: '#6366f1' },
      secondaryColor: { type: String, default: '#4f46e5' },
      position: { 
        type: String, 
        enum: ['bottom-right', 'bottom-left'], 
        default: 'bottom-right' 
      },
      greeting: { type: String, default: 'Hi! How can I help you today?' },
      placeholder: { type: String, default: 'Ask me anything...' },
      suggestedQuestions: [String],
      showSources: { type: Boolean, default: true },
      collectEmail: { type: Boolean, default: false },
    },
    
    allowedOrigins: [String],
    
    apiKey: {
      type: String,
      required: true,
      unique: true,
    },
    
    retrieval: {
      topK: { type: Number, default: 4 },
      similarityThreshold: { type: Number, default: 0.2 },
      reranking: { type: Boolean, default: false },
    },
    
    stats: {
      totalConversations: { type: Number, default: 0 },
      totalMessages: { type: Number, default: 0 },
      avgSatisfactionScore: { type: Number, default: 0 },
      lastActiveAt: Date,
    },
    
    status: {
      type: String,
      enum: ['active', 'draft', 'paused'],
      default: 'draft',
      index: true,
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

// Compount index for uniqueness of slug per project
RagBotSchema.index({ projectId: 1, slug: 1 }, { unique: true });

export const RagBot = mongoose.model<IRagBot>('RagBot', RagBotSchema);
