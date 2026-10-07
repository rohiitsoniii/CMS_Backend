import mongoose, { Document, Schema } from 'mongoose';

export interface IMigration extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  appliedAt: Date;
  batch: number;
  createdAt: Date;
  updatedAt: Date;
}

const migrationSchema = new Schema<IMigration>(
  {
    name: {
      type: String,
      required: [true, 'Migration name is required'],
      unique: true,
      trim: true,
    },
    appliedAt: {
      type: Date,
      required: [true, 'Applied date is required'],
      default: Date.now,
    },
    batch: {
      type: Number,
      required: [true, 'Batch number is required'],
    },
  },
  {
    timestamps: true,
  }
);

// Fast lookup of the latest batch for rollback
migrationSchema.index({ batch: 1 });

export const Migration =
  (mongoose.models.Migration as mongoose.Model<IMigration> | undefined) ??
  mongoose.model<IMigration>('Migration', migrationSchema);
