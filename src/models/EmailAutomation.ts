import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Email automations: a trigger + a sequence of timed emails.
 *
 * Triggers:
 *  - subscribed         a contact joins the audience (form, chatbot, import, manual)
 *  - tag_added          a contact receives a tag
 *  - form_submitted     a specific form is submitted
 *  - content_published  new content of chosen types → newsletter to a segment
 */

export type AutomationTrigger = 'subscribed' | 'tag_added' | 'form_submitted' | 'content_published';

export interface IAutomationStep {
  delayMinutes: number; // wait after the previous step (or trigger)
  subject: string;
  previewText?: string;
  htmlContent: string;
  campaignId?: Types.ObjectId; // hidden campaign used for tracking/stats
}

export interface IEmailAutomation extends Document {
  projectId: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  status: 'draft' | 'active' | 'paused';
  trigger: {
    type: AutomationTrigger;
    tag?: string;
    formId?: Types.ObjectId;
    contentTypes?: string[];
    segmentId?: Types.ObjectId; // content_published: audience
    sendMode?: 'send' | 'draft'; // content_published: send immediately or create a draft campaign
  };
  steps: IAutomationStep[];
  fromName?: string;
  stats: { enrolled: number; completed: number; sent: number };
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const StepSchema = new Schema<IAutomationStep>({
  delayMinutes: { type: Number, min: 0, max: 60 * 24 * 365, default: 0 },
  subject: { type: String, required: true, maxlength: 300 },
  previewText: { type: String, maxlength: 300 },
  htmlContent: { type: String, required: true },
  campaignId: { type: Schema.Types.ObjectId, ref: 'EmailCampaign' },
}, { _id: false });

const EmailAutomationSchema = new Schema<IEmailAutomation>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    status: { type: String, enum: ['draft', 'active', 'paused'], default: 'draft' },
    trigger: {
      type: { type: String, enum: ['subscribed', 'tag_added', 'form_submitted', 'content_published'], required: true },
      tag: { type: String, lowercase: true, trim: true },
      formId: { type: Schema.Types.ObjectId, ref: 'Form' },
      contentTypes: { type: [String], default: undefined },
      segmentId: { type: Schema.Types.ObjectId, ref: 'EmailSegment' },
      sendMode: { type: String, enum: ['send', 'draft'], default: 'draft' },
    },
    steps: { type: [StepSchema], default: [] },
    fromName: { type: String, trim: true },
    stats: {
      enrolled: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
EmailAutomationSchema.index({ projectId: 1, status: 1, 'trigger.type': 1 });

export const EmailAutomation = mongoose.model<IEmailAutomation>('EmailAutomation', EmailAutomationSchema);

export interface IAutomationEnrollment extends Document {
  automationId: Types.ObjectId;
  projectId: Types.ObjectId;
  subscriberId: Types.ObjectId;
  email: string;
  stepIndex: number; // next step to send
  nextRunAt: Date;
  status: 'active' | 'completed' | 'exited';
  createdAt: Date;
}

const EnrollmentSchema = new Schema<IAutomationEnrollment>(
  {
    automationId: { type: Schema.Types.ObjectId, ref: 'EmailAutomation', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    subscriberId: { type: Schema.Types.ObjectId, ref: 'EmailSubscriber', required: true },
    email: { type: String, required: true },
    stepIndex: { type: Number, default: 0 },
    nextRunAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'completed', 'exited'], default: 'active' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
// A contact goes through an automation once
EnrollmentSchema.index({ automationId: 1, subscriberId: 1 }, { unique: true });
EnrollmentSchema.index({ status: 1, nextRunAt: 1 });

export const AutomationEnrollment = mongoose.model<IAutomationEnrollment>('AutomationEnrollment', EnrollmentSchema);
