import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * RAG Conversation Model
 * 
 * Stores chat history between users and the RAG bot for 
 * analytics and memory context.
 */

export interface IRagConversation extends Document {
  _id: Types.ObjectId;
  botId: Types.ObjectId;
  projectId: Types.ObjectId;
  tenantId: Types.ObjectId;
  
  sessionId: string;
  visitorEmail?: string;
  
  messages: {
    role: 'user' | 'assistant';
    content: string;
    sources?: Types.ObjectId[]; // IDs of Knowledge chunks used
    feedback?: 'helpful' | 'not_helpful';
    timestamp: Date;
  }[];
  
  metadata: {
    userAgent?: string;
    ipAddress?: string;
    referrer?: string;
    pageUrl?: string;
  };
  
  satisfaction?: number; // 1-5 rating
  
  createdAt: Date;
  updatedAt: Date;
}

const RagConversationSchema = new Schema<IRagConversation>(
  {
    botId: {
      type: Schema.Types.ObjectId,
      ref: 'RagBot',
      required: true,
      index: true,
    },
    
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
    
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    
    visitorEmail: String,
    
    messages: [
      {
        role: {
          type: String,
          enum: ['user', 'assistant'],
          required: true,
        },
        content: {
          type: String,
          required: true,
        },
        sources: [
          {
            type: Schema.Types.ObjectId,
            ref: 'Knowledge',
          },
        ],
        feedback: {
          type: String,
          enum: ['helpful', 'not_helpful'],
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    
    metadata: {
      userAgent: String,
      ipAddress: String,
      referrer: String,
      pageUrl: String,
    },
    
    satisfaction: {
      type: Number,
      min: 1,
      max: 5,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for analytics efficiently
RagConversationSchema.index({ botId: 1, createdAt: -1 });
RagConversationSchema.index({ sessionId: 1 }, { unique: true });

export const RagConversation = mongoose.model<IRagConversation>('RagConversation', RagConversationSchema);
