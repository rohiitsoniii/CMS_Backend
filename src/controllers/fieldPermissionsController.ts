import { Request, Response } from 'express';
import { FieldPermissionsService } from '../services/fieldPermissionsService';

export const fieldPermissionsController = {
  // Set field permission
  async setPermission(req: Request, res: Response) {
    try {
      const permission = await FieldPermissionsService.setFieldPermission(req.body);
      return res.json(permission);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Get field permissions
  async getPermissions(req: Request, res: Response) {
    try {
      const { contentTypeId, roleId } = req.params;
      const permissions = await FieldPermissionsService.getFieldPermissions(contentTypeId, roleId);
      return res.json(permissions);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Check field access
  async checkAccess(req: Request, res: Response) {
    try {
      const { contentTypeId, fieldPath, roleId } = req.params;
      const { action } = req.query;

      const canAccess = await FieldPermissionsService.canAccessField(
        contentTypeId,
        fieldPath,
        roleId,
        action as 'read' | 'write'
      );

      return res.json({ canAccess });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Get accessible fields
  async getAccessibleFields(req: Request, res: Response) {
    try {
      const { contentTypeId, roleId } = req.params;
      const { action } = req.query;

      const fields = await FieldPermissionsService.getAccessibleFields(
        contentTypeId,
        roleId,
        action as 'read' | 'write'
      );

      return res.json(fields);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Bulk set permissions
  async bulkSetPermissions(req: Request, res: Response) {
    try {
      const { permissions } = req.body;
      const results = await FieldPermissionsService.bulkSetPermissions(permissions);
      return res.json(results);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Delete permission
  async deletePermission(req: Request, res: Response) {
    try {
      const { permissionId } = req.params;
      await FieldPermissionsService.deleteFieldPermission(permissionId);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Get all permissions for content type
  async getAllPermissions(req: Request, res: Response) {
    try {
      const { contentTypeId } = req.params;
      const permissions = await FieldPermissionsService.getAllPermissions(contentTypeId);
      return res.json(permissions);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }
};
