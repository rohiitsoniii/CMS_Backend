import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

export interface ITeamMember extends Document {
    projectId: mongoose.Types.ObjectId;
    userId?: mongoose.Types.ObjectId;
    email: string;
    name: string;
    avatar?: string;
    roleId: mongoose.Types.ObjectId;
    status: 'invited' | 'active' | 'suspended' | 'removed';
    invitedAt: Date;
    joinedAt?: Date;
    lastActiveAt?: Date;
    invitationToken?: string;
    invitationExpiry?: Date;
    invitedBy: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const TeamMemberSchema = new Schema<ITeamMember>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        avatar: {
            type: String,
        },
        roleId: {
            type: Schema.Types.ObjectId,
            ref: 'Role',
            required: true,
        },
        status: {
            type: String,
            enum: ['invited', 'active', 'suspended', 'removed'],
            default: 'invited',
            index: true,
        },
        invitedAt: {
            type: Date,
            default: Date.now,
        },
        joinedAt: {
            type: Date,
        },
        lastActiveAt: {
            type: Date,
        },
        invitationToken: {
            type: String,
        },
        invitationExpiry: {
            type: Date,
        },
        invitedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
TeamMemberSchema.index({ projectId: 1, email: 1 }, { unique: true });
TeamMemberSchema.index({ projectId: 1, status: 1 });
TeamMemberSchema.index({ projectId: 1, roleId: 1 });
TeamMemberSchema.index({ userId: 1 });
TeamMemberSchema.index({ invitationToken: 1 });

// Methods
TeamMemberSchema.methods.generateInvitationToken = function(): string {
    const token = crypto.randomBytes(32).toString('hex');
    this.invitationToken = token;
    this.invitationExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    return token;
};

TeamMemberSchema.methods.acceptInvitation = function(userId: string) {
    this.userId = userId;
    this.status = 'active';
    this.joinedAt = new Date();
    this.invitationToken = undefined;
    this.invitationExpiry = undefined;
};

TeamMemberSchema.methods.updateActivity = function() {
    this.lastActiveAt = new Date();
};

// Static methods
TeamMemberSchema.statics.findByToken = async function(token: string) {
    return this.findOne({
        invitationToken: token,
        invitationExpiry: { $gt: new Date() },
        status: 'invited',
    });
};

export const TeamMember = mongoose.model<ITeamMember>('TeamMember', TeamMemberSchema);
