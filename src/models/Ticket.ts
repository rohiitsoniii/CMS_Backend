import mongoose, { Schema, Document } from 'mongoose';

export interface ITicket extends Document {
  tenant: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: 'technical' | 'billing' | 'feature_request' | 'bug' | 'other';
  assignedTo?: mongoose.Types.ObjectId;
  messages: {
    user: mongoose.Types.ObjectId;
    message: string;
    isStaff: boolean;
    createdAt: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
}

const TicketSchema = new Schema<ITicket>({
  tenant: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: String, required: true },
  description: { type: String, required: true },
  status: { type: String, enum: ['open', 'in_progress', 'waiting', 'resolved', 'closed'], default: 'open' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  category: { type: String, enum: ['technical', 'billing', 'feature_request', 'bug', 'other'], required: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
  messages: [{
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true },
    isStaff: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  resolvedAt: Date
}, { timestamps: true });

TicketSchema.index({ tenant: 1, status: 1 });
TicketSchema.index({ user: 1 });

export const Ticket = mongoose.model<ITicket>('Ticket', TicketSchema);
