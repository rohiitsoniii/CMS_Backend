import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoice extends Document {
  tenantId: mongoose.Types.ObjectId;
  subscriptionId: mongoose.Types.ObjectId;
  stripeInvoiceId: string;
  number: string;
  amount: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  paidAt?: Date;
  dueDate?: Date;
  invoiceUrl?: string;
  invoicePdf?: string;
  items: Array<{
    description: string;
    amount: number;
    quantity: number;
  }>;
}

const InvoiceSchema = new Schema<IInvoice>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', required: true },
  stripeInvoiceId: { type: String, required: true, unique: true },
  number: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'usd' },
  status: { 
    type: String, 
    enum: ['draft', 'open', 'paid', 'void', 'uncollectible'],
    required: true 
  },
  paidAt: { type: Date },
  dueDate: { type: Date },
  invoiceUrl: { type: String },
  invoicePdf: { type: String },
  items: [{
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    quantity: { type: Number, default: 1 }
  }]
}, { timestamps: true });

InvoiceSchema.index({ tenantId: 1, createdAt: -1 });
InvoiceSchema.index({ stripeInvoiceId: 1 });

export const Invoice = mongoose.model<IInvoice>('Invoice', InvoiceSchema);
