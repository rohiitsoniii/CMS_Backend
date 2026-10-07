import mongoose, { Schema, Document } from 'mongoose';

/**
 * Saved audience segment. Rules are evaluated live at send time, so the
 * segment always reflects current subscriber data.
 */

export type SegmentOperator =
    | 'equals' | 'not_equals'
    | 'contains' | 'not_contains'
    | 'starts_with'
    | 'in' | 'not_in'
    | 'exists' | 'not_exists'
    | 'gt' | 'gte' | 'lt' | 'lte'
    | 'within_days' | 'older_than_days';

export interface ISegmentRule {
    field: string;
    operator: SegmentOperator;
    value?: any;
}

export interface IEmailSegment extends Document {
    projectId: mongoose.Types.ObjectId;
    tenantId?: mongoose.Types.ObjectId;
    name: string;
    description?: string;
    match: 'all' | 'any';
    rules: ISegmentRule[];
    lastCount?: number;
    lastCountedAt?: Date;
    createdBy?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const SegmentRuleSchema = new Schema<ISegmentRule>({
    field: { type: String, required: true, maxlength: 100 },
    operator: {
        type: String,
        required: true,
        enum: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'in', 'not_in',
            'exists', 'not_exists', 'gt', 'gte', 'lt', 'lte', 'within_days', 'older_than_days'],
    },
    value: { type: Schema.Types.Mixed },
}, { _id: false });

const EmailSegmentSchema = new Schema<IEmailSegment>(
    {
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
        tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
        name: { type: String, required: true, trim: true, maxlength: 120 },
        description: { type: String, trim: true, maxlength: 500 },
        match: { type: String, enum: ['all', 'any'], default: 'all' },
        rules: { type: [SegmentRuleSchema], default: [] },
        lastCount: { type: Number },
        lastCountedAt: { type: Date },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

export const EmailSegment = mongoose.model<IEmailSegment>('EmailSegment', EmailSegmentSchema);
