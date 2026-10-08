import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Website forms (contact, quote, survey, signup) and their submissions.
 */

export const FORM_FIELD_TYPES = ['text', 'email', 'phone', 'textarea', 'number', 'select', 'radio', 'checkbox', 'date', 'url', 'hidden', 'consent'] as const;
export type FormFieldType = typeof FORM_FIELD_TYPES[number];

export interface IFormField {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  defaultValue?: string;
  maxLength?: number;
}

export interface IForm extends Document {
  projectId: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  description?: string;
  status: 'active' | 'paused';
  fields: IFormField[];
  settings: {
    submitLabel: string;
    successMessage: string;
    redirectUrl?: string;
    notifyEmails: string[];
    addToAudience: boolean;
    audienceTags: string[];
    autoReply?: { enabled: boolean; subject?: string; body?: string };
  };
  stats: { submissions: number; lastSubmissionAt?: Date };
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FieldSchema = new Schema<IFormField>({
  key: { type: String, required: true, match: /^[a-zA-Z][a-zA-Z0-9_]{0,49}$/ },
  label: { type: String, required: true, maxlength: 200 },
  type: { type: String, enum: FORM_FIELD_TYPES, required: true },
  required: { type: Boolean, default: false },
  placeholder: { type: String, maxlength: 200 },
  helpText: { type: String, maxlength: 300 },
  options: { type: [String], default: undefined },
  defaultValue: { type: String, maxlength: 500 },
  maxLength: { type: Number, min: 1, max: 10_000 },
}, { _id: false });

const FormSchema = new Schema<IForm>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    fields: { type: [FieldSchema], default: [] },
    settings: {
      submitLabel: { type: String, default: 'Send', maxlength: 60 },
      successMessage: { type: String, default: 'Thanks! We received your message.', maxlength: 500 },
      redirectUrl: { type: String, maxlength: 500 },
      notifyEmails: { type: [String], default: [] },
      addToAudience: { type: Boolean, default: false },
      audienceTags: { type: [String], default: [] },
      autoReply: {
        enabled: { type: Boolean, default: false },
        subject: { type: String, maxlength: 200 },
        body: { type: String, maxlength: 20_000 },
      },
    },
    stats: {
      submissions: { type: Number, default: 0 },
      lastSubmissionAt: Date,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const Form = mongoose.model<IForm>('Form', FormSchema);

export interface IFormSubmission extends Document {
  formId: Types.ObjectId;
  projectId: Types.ObjectId;
  data: Record<string, string>;
  email?: string;
  status: 'new' | 'read' | 'archived' | 'spam';
  meta: { page?: string; referrer?: string; utm?: Record<string, string>; userAgent?: string };
  createdAt: Date;
}

const FormSubmissionSchema = new Schema<IFormSubmission>(
  {
    formId: { type: Schema.Types.ObjectId, ref: 'Form', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    data: { type: Schema.Types.Mixed, default: {} },
    email: { type: String, lowercase: true, trim: true },
    status: { type: String, enum: ['new', 'read', 'archived', 'spam'], default: 'new' },
    meta: {
      page: String,
      referrer: String,
      utm: Schema.Types.Mixed,
      userAgent: String,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
FormSubmissionSchema.index({ formId: 1, createdAt: -1 });
FormSubmissionSchema.index({ projectId: 1, status: 1, createdAt: -1 });
FormSubmissionSchema.index({ projectId: 1, email: 1 });

export const FormSubmission = mongoose.model<IFormSubmission>('FormSubmission', FormSubmissionSchema);
