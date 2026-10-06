import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export interface IAddress {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    zipCode?: string;
}

export interface IEndUser extends Document {
    projectId: mongoose.Types.ObjectId;
    
    // Authentication
    email: string;
    password: string;
    
    // Profile
    firstName: string;
    lastName: string;
    avatar?: string;
    phone?: string;
    dateOfBirth?: Date;
    
    // Address
    address?: IAddress;
    
    // Custom Fields (tenant-defined)
    customFields: Record<string, any>;
    
    // Status
    status: 'active' | 'suspended' | 'deleted';
    emailVerified: boolean;
    
    // Security
    passwordResetToken?: string;
    passwordResetExpiry?: Date;
    emailVerificationToken?: string;
    
    // Metadata
    lastLoginAt?: Date;
    loginCount: number;
    
    createdAt: Date;
    updatedAt: Date;
    
    // Methods
    comparePassword(candidatePassword: string): Promise<boolean>;
    generatePasswordResetToken(): string;
    generateEmailVerificationToken(): string;
}

const AddressSchema = new Schema({
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String,
}, { _id: false });

const EndUserSchema = new Schema<IEndUser>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        password: {
            type: String,
            required: true,
            select: false,
        },
        firstName: {
            type: String,
            required: true,
            trim: true,
        },
        lastName: {
            type: String,
            required: true,
            trim: true,
        },
        avatar: {
            type: String,
        },
        phone: {
            type: String,
            trim: true,
        },
        dateOfBirth: {
            type: Date,
        },
        address: AddressSchema,
        customFields: {
            type: Schema.Types.Mixed,
            default: {},
        },
        status: {
            type: String,
            enum: ['active', 'suspended', 'deleted'],
            default: 'active',
            index: true,
        },
        emailVerified: {
            type: Boolean,
            default: false,
        },
        passwordResetToken: {
            type: String,
        },
        passwordResetExpiry: {
            type: Date,
        },
        emailVerificationToken: {
            type: String,
        },
        lastLoginAt: {
            type: Date,
        },
        loginCount: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
EndUserSchema.index({ projectId: 1, email: 1 }, { unique: true });
EndUserSchema.index({ projectId: 1, status: 1 });
EndUserSchema.index({ emailVerificationToken: 1 });
EndUserSchema.index({ passwordResetToken: 1 });

// Hash password before saving
EndUserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Compare password method
EndUserSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
    return bcrypt.compare(candidatePassword, this.password);
};

// Generate password reset token
EndUserSchema.methods.generatePasswordResetToken = function(): string {
    const token = crypto.randomBytes(32).toString('hex');
    this.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
    this.passwordResetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    return token;
};

// Generate email verification token
EndUserSchema.methods.generateEmailVerificationToken = function(): string {
    const token = crypto.randomBytes(32).toString('hex');
    this.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
    return token;
};

// Static method to find by reset token
EndUserSchema.statics.findByResetToken = async function(token: string) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    return this.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpiry: { $gt: new Date() },
    });
};

// Static method to find by verification token
EndUserSchema.statics.findByVerificationToken = async function(token: string) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    return this.findOne({
        emailVerificationToken: hashedToken,
    });
};

export const EndUser = mongoose.model<IEndUser>('EndUser', EndUserSchema);
