import mongoose, { Schema, Document } from 'mongoose';

export interface ITicketReply {
    _id?: mongoose.Types.ObjectId;
    message: string;
    isStaffReply: boolean;
    repliedBy: string;
    repliedAt: Date;
    attachments?: string[];
}

export interface ISupportTicket extends Document {
    projectId: mongoose.Types.ObjectId;
    ticketNumber: string;
    
    // Customer Info
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    
    // Ticket Details
    subject: string;
    message: string;
    category: 'technical' | 'billing' | 'general' | 'feature_request';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    status: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
    
    // Assignment
    assignedTo?: mongoose.Types.ObjectId;
    
    // Conversation
    replies: ITicketReply[];
    
    // Metadata
    source: 'website' | 'email' | 'api';
    tags: string[];
    attachments: string[];
    
    createdAt: Date;
    updatedAt: Date;
    resolvedAt?: Date;
    closedAt?: Date;
}

const TicketReplySchema = new Schema<ITicketReply>(
    {
        message: {
            type: String,
            required: true,
        },
        isStaffReply: {
            type: Boolean,
            required: true,
        },
        repliedBy: {
            type: String,
            required: true,
        },
        repliedAt: {
            type: Date,
            default: Date.now,
        },
        attachments: [{
            type: String,
        }],
    },
    { _id: true }
);

const SupportTicketSchema = new Schema<ISupportTicket>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        ticketNumber: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        customerName: {
            type: String,
            required: true,
            trim: true,
        },
        customerEmail: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        customerPhone: {
            type: String,
            trim: true,
        },
        subject: {
            type: String,
            required: true,
            trim: true,
        },
        message: {
            type: String,
            required: true,
        },
        category: {
            type: String,
            enum: ['technical', 'billing', 'general', 'feature_request'],
            default: 'general',
        },
        priority: {
            type: String,
            enum: ['low', 'medium', 'high', 'urgent'],
            default: 'medium',
        },
        status: {
            type: String,
            enum: ['open', 'in_progress', 'waiting', 'resolved', 'closed'],
            default: 'open',
            index: true,
        },
        assignedTo: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        replies: [TicketReplySchema],
        source: {
            type: String,
            enum: ['website', 'email', 'api'],
            default: 'website',
        },
        tags: [{
            type: String,
            trim: true,
        }],
        attachments: [{
            type: String,
        }],
        resolvedAt: {
            type: Date,
        },
        closedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
SupportTicketSchema.index({ projectId: 1, status: 1 });
SupportTicketSchema.index({ projectId: 1, category: 1 });
SupportTicketSchema.index({ projectId: 1, priority: 1 });
SupportTicketSchema.index({ projectId: 1, assignedTo: 1 });
SupportTicketSchema.index({ customerEmail: 1 });
SupportTicketSchema.index({ createdAt: -1 });

// Static method to generate ticket number
SupportTicketSchema.statics.generateTicketNumber = async function(): Promise<string> {
    const count = await this.countDocuments();
    const number = (count + 1).toString().padStart(4, '0');
    return `TKT-${number}`;
};

export const SupportTicket = mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);
