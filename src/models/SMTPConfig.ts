import mongoose, { Schema, Document } from 'mongoose';

export interface ISMTPSettings {
    host: string;
    port: number;
    secure: boolean;
    auth: {
        user: string;
        pass: string;
    };
}

export interface IEmailLimits {
    dailyLimit: number;
    monthlyLimit: number;
    currentDailyCount: number;
    currentMonthlyCount: number;
    lastResetDate: Date;
}

export interface ISMTPConfig extends Document {
    projectId: mongoose.Types.ObjectId;
    
    // Provider
    provider: 'custom' | 'system';
    
    // Custom SMTP (if provider = 'custom')
    smtp?: ISMTPSettings;
    
    // Email Settings
    fromName: string;
    fromEmail: string;
    replyTo?: string;
    
    // Limits (if using system SMTP)
    limits?: IEmailLimits;
    
    // Status
    isActive: boolean;
    isVerified: boolean;
    lastTestedAt?: Date;
    
    createdAt: Date;
    updatedAt: Date;
    
    // Methods
    incrementDailyCount(): void;
    incrementMonthlyCount(): void;
    resetDailyCount(): void;
    resetMonthlyCount(): void;
    canSendEmail(): boolean;
}

const SMTPSettingsSchema = new Schema({
    host: {
        type: String,
        required: true,
    },
    port: {
        type: Number,
        required: true,
    },
    secure: {
        type: Boolean,
        default: false,
    },
    auth: {
        user: {
            type: String,
            required: true,
        },
        pass: {
            type: String,
            required: true,
        },
    },
}, { _id: false });

const EmailLimitsSchema = new Schema({
    dailyLimit: {
        type: Number,
        default: 100,
    },
    monthlyLimit: {
        type: Number,
        default: 1000,
    },
    currentDailyCount: {
        type: Number,
        default: 0,
    },
    currentMonthlyCount: {
        type: Number,
        default: 0,
    },
    lastResetDate: {
        type: Date,
        default: Date.now,
    },
}, { _id: false });

const SMTPConfigSchema = new Schema<ISMTPConfig>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            unique: true,
            index: true,
        },
        provider: {
            type: String,
            enum: ['custom', 'system'],
            default: 'system',
        },
        smtp: SMTPSettingsSchema,
        fromName: {
            type: String,
            required: true,
            trim: true,
        },
        fromEmail: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        replyTo: {
            type: String,
            trim: true,
            lowercase: true,
        },
        limits: EmailLimitsSchema,
        isActive: {
            type: Boolean,
            default: true,
        },
        isVerified: {
            type: Boolean,
            default: false,
        },
        lastTestedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

// Methods
SMTPConfigSchema.methods.incrementDailyCount = function() {
    if (!this.limits) return;
    this.limits.currentDailyCount += 1;
};

SMTPConfigSchema.methods.incrementMonthlyCount = function() {
    if (!this.limits) return;
    this.limits.currentMonthlyCount += 1;
};

SMTPConfigSchema.methods.resetDailyCount = function() {
    if (!this.limits) return;
    this.limits.currentDailyCount = 0;
    this.limits.lastResetDate = new Date();
};

SMTPConfigSchema.methods.resetMonthlyCount = function() {
    if (!this.limits) return;
    this.limits.currentMonthlyCount = 0;
};

SMTPConfigSchema.methods.canSendEmail = function(): boolean {
    if (this.provider === 'custom') return true;
    if (!this.limits) return false;
    
    return (
        this.limits.currentDailyCount < this.limits.dailyLimit &&
        this.limits.currentMonthlyCount < this.limits.monthlyLimit
    );
};

// Static method to get or create config
SMTPConfigSchema.statics.getOrCreate = async function(projectId: string, defaults: any) {
    let config = await this.findOne({ projectId });
    
    if (!config) {
        config = await this.create({
            projectId,
            ...defaults,
        });
    }
    
    return config;
};

export const SMTPConfig = mongoose.model<ISMTPConfig>('SMTPConfig', SMTPConfigSchema);
