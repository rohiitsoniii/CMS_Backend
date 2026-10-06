import mongoose, { Schema, Document } from 'mongoose';

export interface IPermissions {
    // Content Permissions
    content: {
        create: boolean;
        read: boolean;
        update: boolean;
        delete: boolean;
        publish: boolean;
        unpublish: boolean;
        archive: boolean;
    };
    
    // Content Type Permissions
    contentTypes: {
        create: boolean;
        read: boolean;
        update: boolean;
        delete: boolean;
    };
    
    // Media Permissions
    media: {
        upload: boolean;
        read: boolean;
        update: boolean;
        delete: boolean;
        organize: boolean;        // Create folders, move files
    };
    
    // Workflow Permissions
    workflows: {
        create: boolean;
        read: boolean;
        update: boolean;
        delete: boolean;
        approve: boolean;
        reject: boolean;
        assign: boolean;
    };
    
    // Schedule Permissions
    schedules: {
        create: boolean;
        read: boolean;
        update: boolean;
        delete: boolean;
        execute: boolean;         // Execute schedule immediately
    };
    
    // Localization Permissions
    locales: {
        create: boolean;
        read: boolean;
        update: boolean;
        delete: boolean;
        setDefault: boolean;
    };
    
    // Version Control Permissions
    versions: {
        view: boolean;
        compare: boolean;
        restore: boolean;
        delete: boolean;
    };
    
    // Team & User Management Permissions
    team: {
        invite: boolean;
        view: boolean;
        update: boolean;
        remove: boolean;
        assignRoles: boolean;
        suspend: boolean;
    };
    
    // Role Management Permissions
    roles: {
        create: boolean;
        read: boolean;
        update: boolean;
        delete: boolean;
    };
    
    // End User Permissions (Website Users)
    endUsers: {
        view: boolean;
        update: boolean;
        delete: boolean;
        suspend: boolean;
        export: boolean;
    };
    
    // Email Template Permissions
    emailTemplates: {
        create: boolean;
        read: boolean;
        update: boolean;
        delete: boolean;
        send: boolean;            // Send test emails
    };
    
    // Support Ticket Permissions
    supportTickets: {
        view: boolean;
        reply: boolean;
        assign: boolean;
        close: boolean;
        delete: boolean;
    };
    
    // Email Campaign Permissions
    emailCampaigns: {
        create: boolean;
        read: boolean;
        update: boolean;
        delete: boolean;
        send: boolean;
        schedule: boolean;
        pause: boolean;
    };
    
    // Settings Permissions
    settings: {
        viewGeneral: boolean;
        updateGeneral: boolean;
        viewSMTP: boolean;
        updateSMTP: boolean;
        viewAPI: boolean;
        manageAPIKeys: boolean;
    };
    
    // Analytics Permissions
    analytics: {
        view: boolean;
        viewRealtime: boolean;
        export: boolean;
        configure: boolean;
    };
    
    // Project Settings Permissions
    project: {
        view: boolean;
        update: boolean;
        delete: boolean;
        transfer: boolean;        // Transfer ownership
    };
    
    // Custom Permissions (Extensible)
    custom: Record<string, boolean>;
}

export interface IRestrictions {
    contentTypes?: mongoose.Types.ObjectId[];  // Can only access these content types
    maxContent?: number;                       // Max content items they can create
    canPublish?: boolean;                      // Can publish without approval
    ipWhitelist?: string[];                    // IP restrictions
    timeRestrictions?: {                       // Time-based access
        allowedDays?: number[];                // 0-6 (Sunday-Saturday)
        allowedHours?: {
            start: number;                     // 0-23
            end: number;                       // 0-23
        };
    };
}

export interface IRole extends Document {
    projectId: mongoose.Types.ObjectId;
    name: string;
    description?: string;
    permissions: IPermissions;
    restrictions?: IRestrictions;
    isSystemRole: boolean;
    createdBy: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const PermissionsSchema = new Schema({
    content: {
        create: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
        publish: { type: Boolean, default: false },
        unpublish: { type: Boolean, default: false },
        archive: { type: Boolean, default: false },
    },
    contentTypes: {
        create: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
    },
    media: {
        upload: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
        organize: { type: Boolean, default: false },
    },
    workflows: {
        create: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
        approve: { type: Boolean, default: false },
        reject: { type: Boolean, default: false },
        assign: { type: Boolean, default: false },
    },
    schedules: {
        create: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
        execute: { type: Boolean, default: false },
    },
    locales: {
        create: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
        setDefault: { type: Boolean, default: false },
    },
    versions: {
        view: { type: Boolean, default: false },
        compare: { type: Boolean, default: false },
        restore: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
    },
    team: {
        invite: { type: Boolean, default: false },
        view: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        remove: { type: Boolean, default: false },
        assignRoles: { type: Boolean, default: false },
        suspend: { type: Boolean, default: false },
    },
    roles: {
        create: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
    },
    endUsers: {
        view: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
        suspend: { type: Boolean, default: false },
        export: { type: Boolean, default: false },
    },
    emailTemplates: {
        create: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
        send: { type: Boolean, default: false },
    },
    supportTickets: {
        view: { type: Boolean, default: false },
        reply: { type: Boolean, default: false },
        assign: { type: Boolean, default: false },
        close: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
    },
    emailCampaigns: {
        create: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
        send: { type: Boolean, default: false },
        schedule: { type: Boolean, default: false },
        pause: { type: Boolean, default: false },
    },
    settings: {
        viewGeneral: { type: Boolean, default: false },
        updateGeneral: { type: Boolean, default: false },
        viewSMTP: { type: Boolean, default: false },
        updateSMTP: { type: Boolean, default: false },
        viewAPI: { type: Boolean, default: false },
        manageAPIKeys: { type: Boolean, default: false },
    },
    analytics: {
        view: { type: Boolean, default: false },
        viewRealtime: { type: Boolean, default: false },
        export: { type: Boolean, default: false },
        configure: { type: Boolean, default: false },
    },
    project: {
        view: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
        transfer: { type: Boolean, default: false },
    },
    custom: {
        type: Schema.Types.Mixed,
        default: {},
    },
}, { _id: false });

const RestrictionsSchema = new Schema({
    contentTypes: [{
        type: Schema.Types.ObjectId,
        ref: 'ContentType',
    }],
    maxContent: Number,
    canPublish: Boolean,
    ipWhitelist: [String],
    timeRestrictions: {
        allowedDays: [Number],
        allowedHours: {
            start: Number,
            end: Number,
        },
    },
}, { _id: false });

const RoleSchema = new Schema<IRole>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        permissions: {
            type: PermissionsSchema,
            required: true,
        },
        restrictions: RestrictionsSchema,
        isSystemRole: {
            type: Boolean,
            default: false,
        },
        createdBy: {
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
RoleSchema.index({ projectId: 1, name: 1 });
RoleSchema.index({ projectId: 1, isSystemRole: 1 });

// Static method to create default roles
RoleSchema.statics.createDefaultRoles = async function(projectId: string, userId: string) {
    const allTrue = {
        content: { create: true, read: true, update: true, delete: true, publish: true, unpublish: true, archive: true },
        contentTypes: { create: true, read: true, update: true, delete: true },
        media: { upload: true, read: true, update: true, delete: true, organize: true },
        workflows: { create: true, read: true, update: true, delete: true, approve: true, reject: true, assign: true },
        schedules: { create: true, read: true, update: true, delete: true, execute: true },
        locales: { create: true, read: true, update: true, delete: true, setDefault: true },
        versions: { view: true, compare: true, restore: true, delete: true },
        team: { invite: true, view: true, update: true, remove: true, assignRoles: true, suspend: true },
        roles: { create: true, read: true, update: true, delete: true },
        endUsers: { view: true, update: true, delete: true, suspend: true, export: true },
        emailTemplates: { create: true, read: true, update: true, delete: true, send: true },
        supportTickets: { view: true, reply: true, assign: true, close: true, delete: true },
        emailCampaigns: { create: true, read: true, update: true, delete: true, send: true, schedule: true, pause: true },
        settings: { viewGeneral: true, updateGeneral: true, viewSMTP: true, updateSMTP: true, viewAPI: true, manageAPIKeys: true },
        analytics: { view: true, viewRealtime: true, export: true, configure: true },
        project: { view: true, update: true, delete: true, transfer: true },
        custom: {},
    };

    const defaultRoles = [
        {
            name: 'Admin',
            description: 'Full access to all features',
            permissions: allTrue,
            isSystemRole: true,
        },
        {
            name: 'Editor',
            description: 'Can create and manage content',
            permissions: {
                content: { create: true, read: true, update: true, delete: true, publish: true, unpublish: true, archive: true },
                contentTypes: { create: false, read: true, update: false, delete: false },
                media: { upload: true, read: true, update: true, delete: true, organize: true },
                workflows: { create: false, read: true, update: false, delete: false, approve: false, reject: false, assign: false },
                schedules: { create: true, read: true, update: true, delete: true, execute: false },
                locales: { create: false, read: true, update: false, delete: false, setDefault: false },
                versions: { view: true, compare: true, restore: true, delete: false },
                team: { invite: false, view: true, update: false, remove: false, assignRoles: false, suspend: false },
                roles: { create: false, read: true, update: false, delete: false },
                endUsers: { view: true, update: false, delete: false, suspend: false, export: false },
                emailTemplates: { create: true, read: true, update: true, delete: false, send: true },
                supportTickets: { view: true, reply: true, assign: false, close: true, delete: false },
                emailCampaigns: { create: true, read: true, update: true, delete: false, send: true, schedule: true, pause: true },
                settings: { viewGeneral: true, updateGeneral: false, viewSMTP: false, updateSMTP: false, viewAPI: true, manageAPIKeys: false },
                analytics: { view: true, viewRealtime: true, export: true, configure: false },
                project: { view: true, update: false, delete: false, transfer: false },
                custom: {},
            },
            isSystemRole: true,
        },
        {
            name: 'Author',
            description: 'Can create content but not publish',
            permissions: {
                content: { create: true, read: true, update: true, delete: false, publish: false, unpublish: false, archive: false },
                contentTypes: { create: false, read: true, update: false, delete: false },
                media: { upload: true, read: true, update: false, delete: false, organize: false },
                workflows: { create: false, read: true, update: false, delete: false, approve: false, reject: false, assign: false },
                schedules: { create: false, read: true, update: false, delete: false, execute: false },
                locales: { create: false, read: true, update: false, delete: false, setDefault: false },
                versions: { view: true, compare: true, restore: false, delete: false },
                team: { invite: false, view: false, update: false, remove: false, assignRoles: false, suspend: false },
                roles: { create: false, read: false, update: false, delete: false },
                endUsers: { view: false, update: false, delete: false, suspend: false, export: false },
                emailTemplates: { create: false, read: true, update: false, delete: false, send: false },
                supportTickets: { view: false, reply: false, assign: false, close: false, delete: false },
                emailCampaigns: { create: false, read: false, update: false, delete: false, send: false, schedule: false, pause: false },
                settings: { viewGeneral: false, updateGeneral: false, viewSMTP: false, updateSMTP: false, viewAPI: false, manageAPIKeys: false },
                analytics: { view: false, viewRealtime: false, export: false, configure: false },
                project: { view: true, update: false, delete: false, transfer: false },
                custom: {},
            },
            isSystemRole: true,
        },
        {
            name: 'Reviewer',
            description: 'Can approve and publish content',
            permissions: {
                content: { create: false, read: true, update: false, delete: false, publish: true, unpublish: true, archive: false },
                contentTypes: { create: false, read: true, update: false, delete: false },
                media: { upload: false, read: true, update: false, delete: false, organize: false },
                workflows: { create: false, read: true, update: false, delete: false, approve: true, reject: true, assign: false },
                schedules: { create: false, read: true, update: false, delete: false, execute: true },
                locales: { create: false, read: true, update: false, delete: false, setDefault: false },
                versions: { view: true, compare: true, restore: false, delete: false },
                team: { invite: false, view: false, update: false, remove: false, assignRoles: false, suspend: false },
                roles: { create: false, read: false, update: false, delete: false },
                endUsers: { view: true, update: false, delete: false, suspend: false, export: false },
                emailTemplates: { create: false, read: true, update: false, delete: false, send: false },
                supportTickets: { view: true, reply: true, assign: true, close: true, delete: false },
                emailCampaigns: { create: false, read: true, update: false, delete: false, send: true, schedule: false, pause: false },
                settings: { viewGeneral: false, updateGeneral: false, viewSMTP: false, updateSMTP: false, viewAPI: false, manageAPIKeys: false },
                analytics: { view: true, viewRealtime: false, export: false, configure: false },
                project: { view: true, update: false, delete: false, transfer: false },
                custom: {},
            },
            isSystemRole: true,
        },
        {
            name: 'Viewer',
            description: 'Read-only access',
            permissions: {
                content: { create: false, read: true, update: false, delete: false, publish: false, unpublish: false, archive: false },
                contentTypes: { create: false, read: true, update: false, delete: false },
                media: { upload: false, read: true, update: false, delete: false, organize: false },
                workflows: { create: false, read: true, update: false, delete: false, approve: false, reject: false, assign: false },
                schedules: { create: false, read: true, update: false, delete: false, execute: false },
                locales: { create: false, read: true, update: false, delete: false, setDefault: false },
                versions: { view: true, compare: true, restore: false, delete: false },
                team: { invite: false, view: false, update: false, remove: false, assignRoles: false, suspend: false },
                roles: { create: false, read: false, update: false, delete: false },
                endUsers: { view: true, update: false, delete: false, suspend: false, export: false },
                emailTemplates: { create: false, read: true, update: false, delete: false, send: false },
                supportTickets: { view: true, reply: false, assign: false, close: false, delete: false },
                emailCampaigns: { create: false, read: true, update: false, delete: false, send: false, schedule: false, pause: false },
                settings: { viewGeneral: false, updateGeneral: false, viewSMTP: false, updateSMTP: false, viewAPI: false, manageAPIKeys: false },
                analytics: { view: true, viewRealtime: false, export: false, configure: false },
                project: { view: true, update: false, delete: false, transfer: false },
                custom: {},
            },
            isSystemRole: true,
        },
        {
            name: 'Support Agent',
            description: 'Manage support tickets and email campaigns',
            permissions: {
                content: { create: false, read: true, update: false, delete: false, publish: false, unpublish: false, archive: false },
                contentTypes: { create: false, read: true, update: false, delete: false },
                media: { upload: false, read: true, update: false, delete: false, organize: false },
                workflows: { create: false, read: false, update: false, delete: false, approve: false, reject: false, assign: false },
                schedules: { create: false, read: false, update: false, delete: false, execute: false },
                locales: { create: false, read: true, update: false, delete: false, setDefault: false },
                versions: { view: false, compare: false, restore: false, delete: false },
                team: { invite: false, view: false, update: false, remove: false, assignRoles: false, suspend: false },
                roles: { create: false, read: false, update: false, delete: false },
                endUsers: { view: true, update: true, delete: false, suspend: false, export: true },
                emailTemplates: { create: true, read: true, update: true, delete: false, send: true },
                supportTickets: { view: true, reply: true, assign: true, close: true, delete: false },
                emailCampaigns: { create: true, read: true, update: true, delete: false, send: true, schedule: true, pause: true },
                settings: { viewGeneral: false, updateGeneral: false, viewSMTP: false, updateSMTP: false, viewAPI: false, manageAPIKeys: false },
                analytics: { view: true, viewRealtime: false, export: true, configure: false },
                project: { view: true, update: false, delete: false, transfer: false },
                custom: {},
            },
            isSystemRole: true,
        },
    ];

    const roles = await Promise.all(
        defaultRoles.map(role =>
            this.create({
                ...role,
                projectId,
                createdBy: userId,
            })
        )
    );

    return roles;
};

export const Role = mongoose.model<IRole>('Role', RoleSchema);
