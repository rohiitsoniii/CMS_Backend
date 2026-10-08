import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  role: UserRole;
  isSuperAdmin: boolean;
  permissions: string[];

  isActive: boolean;
  isEmailVerified: boolean;
  twoFactorEnabled: boolean;
  emailVerificationToken?: string;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  tokenVersion: number;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  
  // Methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  get fullName(): string;
}

const userSchema = new Schema<IUser>({
  tenantId: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: [true, 'Tenant ID is required'],
    index: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters'],
  },
  lastName: {
    // Optional: many people have a single name ("Prince", "Rohit")
    type: String,
    default: '',
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters'],
  },
  avatar: String,
  role: {
    type: String,
    enum: ['owner', 'admin', 'editor', 'viewer'],
    default: 'editor',
  },
  isSuperAdmin: {
    type: Boolean,
    default: false,
    index: true,
  },
  permissions: [{

    type: String,
    enum: [
      'content:create',
      'content:read',
      'content:update',
      'content:delete',
      'content:publish',
      'media:upload',
      'media:delete',
      'settings:read',
      'settings:update',
      'users:read',
      'users:manage',
      'api-keys:read',
      'api-keys:manage',
      'billing:read',
      'billing:manage',
    ],
  }],
  isActive: { type: Boolean, default: true },
  isEmailVerified: { type: Boolean, default: false },
  twoFactorEnabled: { type: Boolean, default: false },
  emailVerificationToken: String,
  passwordResetToken: String,
  passwordResetExpires: Date,
  // Bumped on logout/password change — invalidates all previously issued tokens
  tokenVersion: { type: Number, default: 0 },
  lastLoginAt: Date,
}, {
  timestamps: true,
});

// Compound unique index for email per tenant
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
userSchema.index({ role: 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Set default permissions based on role
userSchema.pre('save', function(next) {
  if (this.isModified('role') || this.isNew) {
    const rolePermissions: Record<UserRole, string[]> = {
      owner: [
        'content:create', 'content:read', 'content:update', 'content:delete', 'content:publish',
        'media:upload', 'media:delete',
        'settings:read', 'settings:update',
        'users:read', 'users:manage',
        'api-keys:read', 'api-keys:manage',
        'billing:read', 'billing:manage',
      ],
      admin: [
        'content:create', 'content:read', 'content:update', 'content:delete', 'content:publish',
        'media:upload', 'media:delete',
        'settings:read', 'settings:update',
        'users:read', 'users:manage',
        'api-keys:read', 'api-keys:manage',
      ],
      editor: [
        'content:create', 'content:read', 'content:update', 'content:publish',
        'media:upload',
      ],
      viewer: [
        'content:read',
      ],
    };
    
    if (!this.permissions || this.permissions.length === 0) {
      this.permissions = rolePermissions[this.role];
    }
  }
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Ensure virtuals are included in JSON
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

export const User = mongoose.model<IUser>('User', userSchema);
