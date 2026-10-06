import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Content Schedule Model
 * Manages scheduled publishing and unpublishing of content
 */

export interface ISchedule extends Document {
  tenantId: mongoose.Types.ObjectId;
  
  // Content reference
  contentId: mongoose.Types.ObjectId;
  contentType: string;
  contentTitle: string; // Cached for display
  
  // Schedule details
  action: 'publish' | 'unpublish' | 'archive';
  scheduledFor: Date;
  timezone: string; // e.g., 'America/New_York', 'UTC'
  
  // Status
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  executedAt?: Date;
  error?: string;
  
  // Recurrence (optional)
  recurring?: boolean;
  recurrenceRule?: string; // Cron expression or RRULE
  
  // Notifications
  notifyOnCompletion?: boolean;
  notifyUsers?: mongoose.Types.ObjectId[];
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
}

const ScheduleSchema = new Schema<ISchedule>({
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
  contentTitle: {
    type: String,
    required: true,
    trim: true
  },
  action: {
    type: String,
    enum: ['publish', 'unpublish', 'archive'],
    required: true
  },
  scheduledFor: {
    type: Date,
    required: true,
    index: true
  },
  timezone: {
    type: String,
    default: 'UTC',
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  executedAt: {
    type: Date
  },
  error: {
    type: String,
    trim: true
  },
  recurring: {
    type: Boolean,
    default: false
  },
  recurrenceRule: {
    type: String,
    trim: true
  },
  notifyOnCompletion: {
    type: Boolean,
    default: false
  },
  notifyUsers: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
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
ScheduleSchema.index({ tenantId: 1, status: 1, scheduledFor: 1 });
ScheduleSchema.index({ tenantId: 1, contentId: 1 });
ScheduleSchema.index({ status: 1, scheduledFor: 1 }); // For cron job

// Methods
ScheduleSchema.methods.markAsProcessing = function() {
  this.status = 'processing';
};

ScheduleSchema.methods.markAsCompleted = function() {
  this.status = 'completed';
  this.executedAt = new Date();
};

ScheduleSchema.methods.markAsFailed = function(error: string) {
  this.status = 'failed';
  this.executedAt = new Date();
  this.error = error;
};

ScheduleSchema.methods.cancel = function() {
  this.status = 'cancelled';
};

ScheduleSchema.methods.isPending = function(): boolean {
  return this.status === 'pending';
};

ScheduleSchema.methods.isDue = function(): boolean {
  return this.status === 'pending' && new Date() >= this.scheduledFor;
};

// Static methods
ScheduleSchema.statics.findDue = function() {
  return this.find({
    status: 'pending',
    scheduledFor: { $lte: new Date() }
  }).sort({ scheduledFor: 1 });
};

ScheduleSchema.statics.findPending = function(tenantId?: mongoose.Types.ObjectId) {
  const query: any = { status: 'pending' };
  if (tenantId) {
    query.tenantId = tenantId;
  }
  return this.find(query).sort({ scheduledFor: 1 });
};

ScheduleSchema.statics.findByContent = function(contentId: mongoose.Types.ObjectId) {
  return this.find({ contentId }).sort({ scheduledFor: -1 });
};

ScheduleSchema.statics.findUpcoming = function(tenantId: mongoose.Types.ObjectId, limit: number = 10) {
  return this.find({
    tenantId,
    status: 'pending',
    scheduledFor: { $gte: new Date() }
  })
  .sort({ scheduledFor: 1 })
  .limit(limit);
};

ScheduleSchema.statics.cancelByContent = async function(contentId: mongoose.Types.ObjectId) {
  return this.updateMany(
    { contentId, status: 'pending' },
    { status: 'cancelled' }
  );
};

// Pre-save validation
ScheduleSchema.pre('save', function(next) {
  // Validate scheduled time is in the future (for new schedules)
  if (this.isNew && this.scheduledFor <= new Date()) {
    return next(new Error('Scheduled time must be in the future'));
  }
  
  // Validate recurrence rule if recurring
  if (this.recurring && !this.recurrenceRule) {
    return next(new Error('Recurrence rule is required for recurring schedules'));
  }
  
  next();
});

const Schedule: Model<ISchedule> = mongoose.model<ISchedule>('Schedule', ScheduleSchema);

export default Schedule;
