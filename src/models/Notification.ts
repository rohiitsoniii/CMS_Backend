import mongoose, { Schema, Document, Model } from 'mongoose';

export interface INotification extends Document {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: 'workflow' | 'mention' | 'quota' | 'system' | 'publishing';
  title: string;
  message: string;
  isRead: boolean;
  actionUrl?: string;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  tenantId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Tenant', 
    required: true,
    index: true 
  },
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  type: { 
    type: String, 
    enum: ['workflow', 'mention', 'quota', 'system', 'publishing'],
    required: true 
  },
  title: { 
    type: String, 
    required: true,
    trim: true 
  },
  message: { 
    type: String,
    required: true 
  },
  isRead: { 
    type: Boolean, 
    default: false,
    index: true
  },
  actionUrl: { 
    type: String 
  },
  metadata: { 
    type: Schema.Types.Mixed 
  }
}, {
  timestamps: true,
});

// Drop old read notifications
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // 30 days TTl

export const Notification: Model<INotification> = mongoose.model<INotification>('Notification', NotificationSchema);
