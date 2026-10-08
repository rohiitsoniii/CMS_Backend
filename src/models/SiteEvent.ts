import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Privacy-friendly website analytics event (no cookies, no raw IPs).
 * visitorId is a daily-rotating hash, so visitors can't be tracked across days.
 */
export interface ISiteEvent extends Document {
  projectId: Types.ObjectId;
  type: 'pageview' | 'event';
  name?: string; // custom event / conversion name
  path: string;
  title?: string;
  referrerHost?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
  device: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  os: string;
  country?: string;
  visitorId: string;
  sessionId: string;
  props?: Record<string, string>;
  value?: number;
  createdAt: Date;
}

const SiteEventSchema = new Schema<ISiteEvent>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    type: { type: String, enum: ['pageview', 'event'], required: true },
    name: { type: String, maxlength: 80 },
    path: { type: String, required: true, maxlength: 500 },
    title: { type: String, maxlength: 300 },
    referrerHost: { type: String, maxlength: 200 },
    utm: {
      source: { type: String, maxlength: 100 },
      medium: { type: String, maxlength: 100 },
      campaign: { type: String, maxlength: 150 },
    },
    device: { type: String, enum: ['desktop', 'mobile', 'tablet'], default: 'desktop' },
    browser: { type: String, maxlength: 40 },
    os: { type: String, maxlength: 40 },
    country: { type: String, maxlength: 2 },
    visitorId: { type: String, required: true },
    sessionId: { type: String, required: true, maxlength: 64 },
    props: { type: Schema.Types.Mixed },
    value: { type: Number },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

SiteEventSchema.index({ projectId: 1, createdAt: -1 });
SiteEventSchema.index({ projectId: 1, type: 1, createdAt: -1 });
// Keep raw events ~13 months (configurable at index creation)
SiteEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: Number(process.env.ANALYTICS_RETENTION_DAYS || 400) * 86_400 });

export const SiteEvent = mongoose.model<ISiteEvent>('SiteEvent', SiteEventSchema);
