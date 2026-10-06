import { Request, Response } from 'express';
import { Role } from '../models/Role';

export class RoleController {
    // Get all roles for a project
    async getRoles(req: Request, res: Response): Promise<any> {
        try {
            const { projectId } = req.query;

            if (!projectId || projectId === 'undefined') {
                return res.json({
                    success: true,
                    data: [],
                });
            }

            const roles = await Role.find({ projectId })
                .populate('createdBy', 'name email')
                .sort({ isSystemRole: -1, createdAt: -1 });

            return res.json({
                success: true,
                data: roles,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch roles',
                error: error.message,
            });
        }
    }

    // Get single role
    async getRole(req: Request, res: Response): Promise<any> {
        try {
            const { id } = req.params;

            const role = await Role.findById(id)
                .populate('createdBy', 'name email');

            if (!role) {
                return res.status(404).json({
                    success: false,
                    message: 'Role not found',
                });
            }

            return res.json({
                success: true,
                data: role,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch role',
                error: error.message,
            });
        }
    }

    // Create custom role
    async createRole(req: Request, res: Response): Promise<any> {
        try {
            const { projectId, name, description, permissions, restrictions } = req.body;
            const userId = (req as any).user.id;

            if (!projectId || !name || !permissions) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                });
            }

            // Check if role name already exists
            const existingRole = await Role.findOne({ projectId, name });
            if (existingRole) {
                return res.status(400).json({
                    success: false,
                    message: 'Role with this name already exists',
                });
            }

            const role = await Role.create({
                projectId,
                name,
                description,
                permissions,
                restrictions,
                isSystemRole: false,
                createdBy: userId,
            });

            return res.status(201).json({
                success: true,
                data: role,
                message: 'Role created successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to create role',
                error: error.message,
            });
        }
    }

    // Update role
    async updateRole(req: Request, res: Response): Promise<any> {
        try {
            const { id } = req.params;
            const { name, description, permissions, restrictions } = req.body;

            const role = await Role.findById(id);

            if (!role) {
                return res.status(404).json({
                    success: false,
                    message: 'Role not found',
                });
            }

            // Cannot update system roles
            if (role.isSystemRole) {
                return res.status(403).json({
                    success: false,
                    message: 'Cannot update system roles',
                });
            }

            // Check if new name conflicts
            if (name && name !== role.name) {
                const existingRole = await Role.findOne({
                    projectId: role.projectId,
                    name,
                    _id: { $ne: id },
                });

                if (existingRole) {
                    return res.status(400).json({
                        success: false,
                        message: 'Role with this name already exists',
                    });
                }
            }

            role.name = name || role.name;
            role.description = description !== undefined ? description : role.description;
            role.permissions = permissions || role.permissions;
            role.restrictions = restrictions !== undefined ? restrictions : role.restrictions;

            await role.save();

            return res.json({
                success: true,
                data: role,
                message: 'Role updated successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to update role',
                error: error.message,
            });
        }
    }

    // Delete role
    async deleteRole(req: Request, res: Response): Promise<any> {
        try {
            const { id } = req.params;

            const role = await Role.findById(id);

            if (!role) {
                return res.status(404).json({
                    success: false,
                    message: 'Role not found',
                });
            }

            // Cannot delete system roles
            if (role.isSystemRole) {
                return res.status(403).json({
                    success: false,
                    message: 'Cannot delete system roles',
                });
            }

            // Check if role is assigned to any team members
            const { TeamMember } = require('../models/TeamMember');
            const assignedCount = await TeamMember.countDocuments({ roleId: id });

            if (assignedCount > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot delete role. It is assigned to ${assignedCount} team member(s)`,
                });
            }

            await role.deleteOne();

            return res.json({
                success: true,
                message: 'Role deleted successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to delete role',
                error: error.message,
            });
        }
    }

    // Get default system roles
    async getDefaultRoles(req: Request, res: Response): Promise<any> {
        try {
            const { projectId } = req.query;

            if (!projectId) {
                return res.status(400).json({
                    success: false,
                    message: 'Project ID is required',
                });
            }

            const roles = await Role.find({
                projectId,
                isSystemRole: true,
            }).sort({ createdAt: 1 });

            return res.json({
                success: true,
                data: roles,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch default roles',
                error: error.message,
            });
        }
    }

    // Clone role
    async cloneRole(req: Request, res: Response): Promise<any> {
        try {
            const { id } = req.params;
            const { name } = req.body;
            const userId = (req as any).user.id;

            const sourceRole = await Role.findById(id);

            if (!sourceRole) {
                return res.status(404).json({
                    success: false,
                    message: 'Source role not found',
                });
            }

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'New role name is required',
                });
            }

            // Check if name exists
            const existingRole = await Role.findOne({
                projectId: sourceRole.projectId,
                name,
            });

            if (existingRole) {
                return res.status(400).json({
                    success: false,
                    message: 'Role with this name already exists',
                });
            }

            const newRole = await Role.create({
                projectId: sourceRole.projectId,
                name,
                description: sourceRole.description,
                permissions: sourceRole.permissions,
                restrictions: sourceRole.restrictions,
                isSystemRole: false,
                createdBy: userId,
            });

            return res.status(201).json({
                success: true,
                data: newRole,
                message: 'Role cloned successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to clone role',
                error: error.message,
            });
        }
    }
}

export const roleController = new RoleController();
