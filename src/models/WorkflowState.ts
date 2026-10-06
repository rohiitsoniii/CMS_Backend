import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Workflow State Model
 * Tracks content progression through workflows
 */

export interface IWorkflowAction {
  action: 'advance' | 'reject' | 'comment' | 'assign';
  stepId: string;
  stepName: string;
  performedBy: mongoose.Types.ObjectId;
  performedAt: Date;
  comment?: string;
  assignedTo?: mongoose.Types.ObjectId[];
}

export interface IWorkflowState extends Document {
  tenantId: mongoose.Types.ObjectId;
  
  // Content reference
  contentId: mongoose.Types.ObjectId;
  contentType: string; // Content type apiId
  
  // Workflow reference
  workflowId: mongoose.Types.ObjectId;
  workflowName: string;
  
  // Current state
  currentStepId: string;
  currentStepName: string;
  status: 'in_progress' | 'approved' | 'rejected' | 'completed';
  
  // Assignment
  assignedTo: mongoose.Types.ObjectId[];
  
  // History
  history: IWorkflowAction[];
  
  // Timestamps
  startedAt: Date;
  completedAt?: Date;
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowActionSchema = new Schema<IWorkflowAction>({
  action: {
    type: String,
    enum: ['advance', 'reject', 'comment', 'assign'],
    required: true
  },
  stepId: {
    type: String,
    required: true
  },
  stepName: {
    type: String,
    required: true
  },
  performedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  performedAt: {
    type: Date,
    default: Date.now
  },
  comment: {
    type: String,
    trim: true
  },
  assignedTo: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }]
}, { _id: false });

const WorkflowStateSchema = new Schema<IWorkflowState>({
  tenantId: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  contentId: {
    type: Schema.Types.ObjectId,
    ref: 'Content',
    required: true,
    index: true
  },
  contentType: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  workflowId: {
    type: Schema.Types.ObjectId,
    ref: 'Workflow',
    required: true,
    index: true
  },
  workflowName: {
    type: String,
    required: true
  },
  currentStepId: {
    type: String,
    required: true
  },
  currentStepName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['in_progress', 'approved', 'rejected', 'completed'],
    default: 'in_progress',
    index: true
  },
  assignedTo: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  history: {
    type: [WorkflowActionSchema],
    default: []
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
WorkflowStateSchema.index({ tenantId: 1, contentId: 1 });
WorkflowStateSchema.index({ tenantId: 1, status: 1 });
WorkflowStateSchema.index({ tenantId: 1, assignedTo: 1 });
WorkflowStateSchema.index({ tenantId: 1, workflowId: 1 });

// Methods
WorkflowStateSchema.methods.addAction = function(action: IWorkflowAction) {
  this.history.push(action);
};

WorkflowStateSchema.methods.isAssignedTo = function(userId: mongoose.Types.ObjectId): boolean {
  if (!this.assignedTo || this.assignedTo.length === 0) {
    return true; // No specific assignment
  }
  
  return this.assignedTo.some(id => id.toString() === userId.toString());
};

WorkflowStateSchema.methods.complete = function() {
  this.status = 'completed';
  this.completedAt = new Date();
};

WorkflowStateSchema.methods.approve = function() {
  this.status = 'approved';
  this.completedAt = new Date();
};

WorkflowStateSchema.methods.reject = function() {
  this.status = 'rejected';
  this.completedAt = new Date();
};

// Static methods
WorkflowStateSchema.statics.findByContent = function(contentId: mongoose.Types.ObjectId) {
  return this.findOne({ contentId, status: 'in_progress' });
};

WorkflowStateSchema.statics.findByTenant = function(tenantId: mongoose.Types.ObjectId, status?: string) {
  const query: any = { tenantId };
  if (status) {
    query.status = status;
  }
  return this.find(query);
};

WorkflowStateSchema.statics.findAssignedTo = function(userId: mongoose.Types.ObjectId, status: string = 'in_progress') {
  return this.find({
    assignedTo: userId,
    status
  });
};

WorkflowStateSchema.statics.findByWorkflow = function(workflowId: mongoose.Types.ObjectId, status?: string) {
  const query: any = { workflowId };
  if (status) {
    query.status = status;
  }
  return this.find(query);
};

const WorkflowState: Model<IWorkflowState> = mongoose.model<IWorkflowState>('WorkflowState', WorkflowStateSchema);

export default WorkflowState;
