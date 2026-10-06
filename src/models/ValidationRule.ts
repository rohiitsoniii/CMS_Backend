import mongoose, { Schema, Document } from 'mongoose';

export interface IValidationRule extends Document {
  projectId: mongoose.Types.ObjectId;
  contentTypeId: mongoose.Types.ObjectId;
  fieldPath: string;
  ruleType: 'regex' | 'range' | 'length' | 'custom' | 'crossField' | 'async';
  config: {
    pattern?: string;
    min?: number;
    max?: number;
    customFunction?: string;
    dependentFields?: string[];
    asyncUrl?: string;
  };
  errorMessage: string;
  enabled: boolean;
}

const ValidationRuleSchema = new Schema<IValidationRule>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  contentTypeId: { type: Schema.Types.ObjectId, ref: 'ContentType', required: true, index: true },
  fieldPath: { type: String, required: true },
  ruleType: { 
    type: String, 
    enum: ['regex', 'range', 'length', 'custom', 'crossField', 'async'], 
    required: true 
  },
  config: {
    pattern: String,
    min: Number,
    max: Number,
    customFunction: String,
    dependentFields: [String],
    asyncUrl: String
  },
  errorMessage: { type: String, required: true },
  enabled: { type: Boolean, default: true }
}, { timestamps: true });

ValidationRuleSchema.index({ contentTypeId: 1, fieldPath: 1 });

export const ValidationRule = mongoose.model<IValidationRule>('ValidationRule', ValidationRuleSchema);
