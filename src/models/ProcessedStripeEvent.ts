import mongoose, { Schema, Document } from 'mongoose';

export interface IProcessedStripeEvent extends Document {
  eventId: string;
  type: string;
  receivedAt: Date;
}

const ProcessedStripeEventSchema = new Schema<IProcessedStripeEvent>({
  eventId: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  receivedAt: { type: Date, default: Date.now },
});

ProcessedStripeEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const ProcessedStripeEvent = mongoose.model<IProcessedStripeEvent>(
  'ProcessedStripeEvent',
  ProcessedStripeEventSchema
);
