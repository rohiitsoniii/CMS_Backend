import mongoose, { Schema, Document } from 'mongoose';

export interface IFieldPermission extends Document {
  projectId: mongoose.Types.ObjectId;
  contentTypeId: mongoose.Types.ObjectId;
  fieldPath: string;
  roleId: mongoose.Types.ObjectId;
  permission: 'hidden' | 'read' | 'write';
}

const FieldPermissionSchema = new Schema<IFieldPermission>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  contentTypeId: { type: Schema.Types.ObjectId, ref: 'ContentType', required: true, index: true },
  fieldPath: { type: String, required: true },
  roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
  permission: { type: String, enum: ['hidden', 'read', 'write'], required: true }
}, { timestamps: true });

FieldPermissionSchema.index({ contentTypeId: 1, roleId: 1 });

export const FieldPermission = mongoose.model<IFieldPermission>('FieldPermission', FieldPermissionSchema);

export class FieldPermissionsService {
  // Set field permission
  static async setFieldPermission(data: {
    projectId: string;
    contentTypeId: string;
    fieldPath: string;
    roleId: string;
    permission: 'hidden' | 'read' | 'write';
  }) {
    return FieldPermission.findOneAndUpdate(
      {
        projectId: data.projectId,
        contentTypeId: data.contentTypeId,
        fieldPath: data.fieldPath,
        roleId: data.roleId
      },
      { permission: data.permission },
      { upsert: true, new: true }
    );
  }

  // Get field permissions for role
  static async getFieldPermissions(contentTypeId: string, roleId: string) {
    return FieldPermission.find({ contentTypeId, roleId });
  }

  // Check if user can access field
  static async canAccessField(
    contentTypeId: string,
    fieldPath: string,
    roleId: string,
    action: 'read' | 'write'
  ): Promise<boolean> {
    const permission = await FieldPermission.findOne({
      contentTypeId,
      fieldPath,
      roleId
    });

    if (!permission) return true; // No restriction = full access

    if (permission.permission === 'hidden') return false;
    if (action === 'write' && permission.permission === 'read') return false;

    return true;
  }

  // Filter content data based on permissions
  static async filterContentByPermissions(
    contentTypeId: string,
    roleId: string,
    data: any,
    action: 'read' | 'write'
  ) {
    const permissions = await this.getFieldPermissions(contentTypeId, roleId);
    const filtered: any = { ...data };

    for (const perm of permissions) {
      if (perm.permission === 'hidden') {
        delete filtered[perm.fieldPath];
      } else if (action === 'write' && perm.permission === 'read') {
        delete filtered[perm.fieldPath];
      }
    }

    return filtered;
  }

  // Get accessible fields for role
  static async getAccessibleFields(
    contentTypeId: string,
    roleId: string,
    action: 'read' | 'write'
  ) {
    const permissions = await this.getFieldPermissions(contentTypeId, roleId);
    const hiddenFields = permissions
      .filter(p => 
        p.permission === 'hidden' || 
        (action === 'write' && p.permission === 'read')
      )
      .map(p => p.fieldPath);

    return { hiddenFields };
  }

  // Bulk set permissions
  static async bulkSetPermissions(permissions: any[]) {
    const results = [];
    
    for (const perm of permissions) {
      try {
        const set = await this.setFieldPermission(perm);
        results.push({ success: true, permission: set });
      } catch (error: any) {
        results.push({ success: false, error: error.message });
      }
    }

    return results;
  }

  // Delete field permission
  static async deleteFieldPermission(permissionId: string) {
    return FieldPermission.findByIdAndDelete(permissionId);
  }

  // Get all permissions for content type
  static async getAllPermissions(contentTypeId: string) {
    return FieldPermission.find({ contentTypeId })
      .populate('roleId', 'name')
      .sort({ fieldPath: 1 });
  }
}
