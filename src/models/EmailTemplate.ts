import mongoose, { Schema, Document } from 'mongoose';

export interface IEmailTemplate extends Document {
    projectId: mongoose.Types.ObjectId;
    name: string;
    subject: string;
    body: string;
    variables: string[];
    category: 'transactional' | 'marketing' | 'support';
    isActive: boolean;
    createdBy: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const EmailTemplateSchema = new Schema<IEmailTemplate>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        subject: {
            type: String,
            required: true,
            trim: true,
        },
        body: {
            type: String,
            required: true,
        },
        variables: [{
            type: String,
            trim: true,
        }],
        category: {
            type: String,
            enum: ['transactional', 'marketing', 'support'],
            default: 'transactional',
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
EmailTemplateSchema.index({ projectId: 1, name: 1 });
EmailTemplateSchema.index({ projectId: 1, category: 1 });
EmailTemplateSchema.index({ projectId: 1, isActive: 1 });

// Methods
EmailTemplateSchema.methods.replaceVariables = function(variables: Record<string, any>): { subject: string; body: string } {
    let subject = this.subject;
    let body = this.body;

    // Replace all variables
    Object.keys(variables).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        subject = subject.replace(regex, variables[key] || '');
        body = body.replace(regex, variables[key] || '');
    });

    return { subject, body };
};

export const EmailTemplate = mongoose.model<IEmailTemplate>('EmailTemplate', EmailTemplateSchema);
