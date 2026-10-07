import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Workflow Model
 * Manages content approval workflows
 */

export interface IWorkflowStep {
  id: string;
  name: string;
  description?: string;
  assignedTo?: mongoose.Types.ObjectId[]; // User IDs
  assignedRoles?: string[]; // Role names
  requiresApproval: boolean;
  order: number;
  autoAdvance?: boolean; // Auto-advance to next step
  notifyOnEntry?: boolean; // Send notification when content enters this step
}

export interface IWorkflow extends Document {
  tenantId: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;

  // Workflow details
  name: string;
  description?: string;
  apiId: string; // e.g., 'blog-approval-workflow'
  
  // Steps
  steps: IWorkflowStep[];
  
  // Configuration
  isActive: boolean;
  isDefault: boolean; // Default workflow for new content
  
  // Applicable to
  contentTypes: string[]; // Content type apiIds this workflow applies to
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
}

const WorkflowStepSchema = new Schema<IWorkflowStep>({
  id: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  assignedTo: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  assignedRoles: [{
    type: String,
    trim: true
  }],
  requiresApproval: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    required: true
  },
  autoAdvance: {
    type: Boolean,
    default: false
  },
  notifyOnEntry: {
    type: Boolean,
    default: true
  }
}, { _id: false });

const WorkflowSchema = new Schema<IWorkflow>({
  tenantId: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  apiId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  steps: {
    type: [WorkflowStepSchema],
    required: true,
    validate: {
      validator: function(steps: IWorkflowStep[]) {
        return steps.length > 0;
      },
      message: 'Workflow must have at least one step'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  contentTypes: [{
    type: String,
    lowercase: true,
    trim: true
  }],
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Indexes
WorkflowSchema.index({ tenantId: 1, apiId: 1 }, { unique: true });
WorkflowSchema.index({ tenantId: 1, isDefault: 1 });
WorkflowSchema.index({ tenantId: 1, contentTypes: 1 });

// Methods
WorkflowSchema.methods.getStep = function(this: any, stepId: string): IWorkflowStep | undefined {
  return this.steps.find((s: IWorkflowStep) => s.id === stepId);
};

WorkflowSchema.methods.getNextStep = function(this: any, currentStepId: string): IWorkflowStep | undefined {
  const currentStep = this.getStep(currentStepId);
  if (!currentStep) return undefined;

  const nextOrder = currentStep.order + 1;
  return this.steps.find((s: IWorkflowStep) => s.order === nextOrder);
};

WorkflowSchema.methods.getPreviousStep = function(this: any, currentStepId: string): IWorkflowStep | undefined {
  const currentStep = this.getStep(currentStepId);
  if (!currentStep) return undefined;

  const prevOrder = currentStep.order - 1;
  return this.steps.find((s: IWorkflowStep) => s.order === prevOrder);
};

WorkflowSchema.methods.getFirstStep = function(this: any): IWorkflowStep | undefined {
  return this.steps.find((s: IWorkflowStep) => s.order === 0) || this.steps[0];
};

WorkflowSchema.methods.getLastStep = function(this: any): IWorkflowStep | undefined {
  return this.steps.reduce((last: IWorkflowStep, current: IWorkflowStep) =>
    current.order > (last?.order || -1) ? current : last
  );
};

WorkflowSchema.methods.isStepAssignedTo = function(this: any, stepId: string, userId: mongoose.Types.ObjectId): boolean {
  const step = this.getStep(stepId);
  if (!step) return false;

  if (!step.assignedTo || step.assignedTo.length === 0) {
    return true; // No specific assignment means anyone can approve
  }

  return step.assignedTo.some((id: any) => id.toString() === userId.toString());
};

// Static methods
WorkflowSchema.statics.findByTenant = function(this: any, tenantId: mongoose.Types.ObjectId) {
  return this.find({ tenantId, isActive: true });
};

WorkflowSchema.statics.findByApiId = function(this: any, tenantId: mongoose.Types.ObjectId, apiId: string) {
  return this.findOne({ tenantId, apiId });
};

WorkflowSchema.statics.findDefault = function(this: any, tenantId: mongoose.Types.ObjectId) {
  return this.findOne({ tenantId, isDefault: true, isActive: true });
};

WorkflowSchema.statics.findForContentType = function(this: any, tenantId: mongoose.Types.ObjectId, contentTypeApiId: string) {
  return this.find({
    tenantId,
    isActive: true,
    contentTypes: contentTypeApiId
  });
};

WorkflowSchema.statics.apiIdExists = async function(this: any, tenantId: mongoose.Types.ObjectId, apiId: string) {
  const count = await this.countDocuments({ tenantId, apiId });
  return count > 0;
};

// Pre-save validation
WorkflowSchema.pre('save', async function(this: any, next) {
  // Ensure steps have unique IDs
  const stepIds = this.steps.map((s: IWorkflowStep) => s.id);
  const uniqueIds = new Set(stepIds);
  if (stepIds.length !== uniqueIds.size) {
    throw new Error('Step IDs must be unique');
  }
  
  // Ensure steps have sequential orders starting from 0
  const orders = this.steps.map((s: IWorkflowStep) => s.order).sort((a: number, b: number) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i) {
      throw new Error('Step orders must be sequential starting from 0');
    }
  }
  
  // If setting as default, unset other defaults
  if (this.isDefault) {
    await this.constructor.updateMany(
      { tenantId: this.tenantId, _id: { $ne: this._id } },
      { isDefault: false }
    );
  }
  
  next();
});

const Workflow: Model<IWorkflow> = mongoose.model<IWorkflow>('Workflow', WorkflowSchema);

export default Workflow;
