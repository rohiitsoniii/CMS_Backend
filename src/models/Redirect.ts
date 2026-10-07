import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * URL redirects (301/302/307/308) and gone (410) rules, served to headless
 * frontends via the public SEO API, plus a 404 log to find broken URLs.
 */

export interface IRedirect extends Document {
  projectId: Types.ObjectId;
  tenantId: Types.ObjectId;
  from: string; // normalised path, e.g. /old-page
  to?: string; // path or absolute URL; empty for 410
  statusCode: 301 | 302 | 307 | 308 | 410;
  isActive: boolean;
  note?: string;
  hits: number;
  lastHitAt?: Date;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RedirectSchema = new Schema<IRedirect>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    from: { type: String, required: true, trim: true, maxlength: 1000 },
    to: { type: String, trim: true, maxlength: 2000 },
    statusCode: { type: Number, enum: [301, 302, 307, 308, 410], default: 301 },
    isActive: { type: Boolean, default: true },
    note: { type: String, trim: true, maxlength: 300 },
    hits: { type: Number, default: 0 },
    lastHitAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
RedirectSchema.index({ projectId: 1, from: 1 }, { unique: true });

export const Redirect = mongoose.model<IRedirect>('Redirect', RedirectSchema);

export interface INotFoundLog extends Document {
  projectId: Types.ObjectId;
  path: string;
  hits: number;
  lastReferrer?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolved: boolean;
}

const NotFoundLogSchema = new Schema<INotFoundLog>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  path: { type: String, required: true, maxlength: 1000 },
  hits: { type: Number, default: 1 },
  lastReferrer: { type: String, maxlength: 1000 },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  resolved: { type: Boolean, default: false },
});
NotFoundLogSchema.index({ projectId: 1, path: 1 }, { unique: true });
NotFoundLogSchema.index({ projectId: 1, hits: -1 });
// Forget 404s not seen for 90 days
NotFoundLogSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 90 * 86_400 });

export const NotFoundLog = mongoose.model<INotFoundLog>('NotFoundLog', NotFoundLogSchema);

/** Normalise a path for matching: leading slash, no trailing slash, no query/hash, lowercase. */
export function normalizePath(input: string): string {
  let p = String(input || '').trim();
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {
    /* keep as-is */
  }
  p = p.split('#')[0].split('?')[0];
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p.toLowerCase();
}
