import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { TeamMember } from '../models/TeamMember';
import { Role } from '../models/Role';
import nodemailer from 'nodemailer';

export class TeamMemberController {
    // Get all team members for a project
    async getTeamMembers(req: Request, res: Response) {
        try {
            const { projectId, status } = req.query;

            if (!projectId || projectId === 'undefined') {
                return res.json({
                    success: true,
                    data: [],
                });
            }

            const filter: any = { projectId };
            if (status) filter.status = status;

            const members = await TeamMember.find(filter)
                .populate('roleId', 'name description permissions')
                .populate('userId', 'name email avatar')
                .populate('invitedBy', 'name email')
                .sort({ createdAt: -1 });

            return res.json({
                success: true,
                data: members,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch team members',
                error: error.message,
            });
        }
    }

    // Get single team member
    async getTeamMember(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const member = await TeamMember.findById(id)
                .populate('roleId', 'name description permissions')
                .populate('userId', 'name email avatar')
                .populate('invitedBy', 'name email');

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: 'Team member not found',
                });
            }

            return res.json({
                success: true,
                data: member,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch team member',
                error: error.message,
            });
        }
    }

    // Invite team member
    async inviteTeamMember(req: Request, res: Response) {
        try {
            let { projectId, email, name, roleId, role: roleName } = req.body;
            const userId = (req as any).user?.id || (req as any).user?._id;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: 'Email is required',
                });
            }

            if (!name) {
                name = email.split('@')[0];
            }

            // Fallback for projectId if not specified
            if (!projectId) {
                const { Project } = await import('../models/Project.js');
                const tenantId = (req as any).tenantId || (req as any).user?.tenantId;
                const userProject = await Project.findOne(
                    tenantId ? { tenantId } : { ownerId: userId }
                );
                if (userProject) {
                    projectId = userProject._id.toString();
                }
            }

            if (!projectId) {
                return res.status(400).json({
                    success: false,
                    message: 'Project ID is required',
                });
            }

            // Resolve role
            let role = null;
            if (roleId && mongoose.isValidObjectId(roleId)) {
                role = await Role.findById(roleId);
            }
            if (!role) {
                const targetName = roleName || 'Editor';
                role = await Role.findOne({ 
                    name: { $regex: new RegExp(`^${targetName}$`, 'i') } 
                }) || await Role.findOne({ isDefault: true }) || await Role.findOne();
            }

            if (!role) {
                return res.status(404).json({
                    success: false,
                    message: 'Role not found',
                });
            }

            roleId = role._id;

            // Prevent duplicate invites for same project + email
            const existingMember = await TeamMember.findOne({
                projectId,
                email,
                status: { $in: ['invited', 'active'] },
            });

            if (existingMember) {
                return res.status(400).json({
                    success: false,
                    message: 'User already invited or is a team member',
                });
            }

            // Create team member
            const member = await TeamMember.create({
                projectId,
                email,
                name,
                roleId,
                status: 'invited',
                invitedBy: userId,
            });

            // Generate invitation token
            const token = (member as any).generateInvitationToken();
            await member.save();

            // Send invitation email
            await this.sendInvitationEmail(member, token);

            const populatedMember = await TeamMember.findById(member._id)
                .populate('roleId', 'name description')
                .populate('invitedBy', 'name email');

            return res.status(201).json({
                success: true,
                data: populatedMember,
                message: 'Team member invited successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to invite team member',
                error: error.message,
            });
        }
    }

    // Accept invitation
    async acceptInvitation(req: Request, res: Response) {
        try {
            const { token } = req.body;
            const userId = (req as any).user?.id;

            if (!token) {
                return res.status(400).json({
                    success: false,
                    message: 'Invitation token is required',
                });
            }

            const member = await (TeamMember as any).findByToken(token);

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: 'Invalid or expired invitation',
                });
            }

            if (userId) {
                member.acceptInvitation(userId);
            } else {
                // If no user ID, just mark as active (they'll link later)
                member.status = 'active';
                member.joinedAt = new Date();
                member.invitationToken = undefined;
                member.invitationExpiry = undefined;
            }

            await member.save();

            const populatedMember = await TeamMember.findById(member._id)
                .populate('roleId', 'name description permissions')
                .populate('userId', 'name email avatar');

            return res.json({
                success: true,
                data: populatedMember,
                message: 'Invitation accepted successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to accept invitation',
                error: error.message,
            });
        }
    }

    // Update team member
    async updateTeamMember(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { name, avatar } = req.body;

            const member = await TeamMember.findByIdAndUpdate(
                id,
                { name, avatar },
                { new: true, runValidators: true }
            ).populate('roleId', 'name description');

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: 'Team member not found',
                });
            }

            return res.json({
                success: true,
                data: member,
                message: 'Team member updated successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to update team member',
                error: error.message,
            });
        }
    }

    // Change team member role
    async changeRole(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { roleId } = req.body;

            if (!roleId) {
                return res.status(400).json({
                    success: false,
                    message: 'Role ID is required',
                });
            }

            // Verify role exists
            const role = await Role.findById(roleId);
            if (!role) {
                return res.status(404).json({
                    success: false,
                    message: 'Role not found',
                });
            }

            const member = await TeamMember.findByIdAndUpdate(
                id,
                { roleId },
                { new: true }
            ).populate('roleId', 'name description permissions');

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: 'Team member not found',
                });
            }

            return res.json({
                success: true,
                data: member,
                message: 'Role changed successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to change role',
                error: error.message,
            });
        }
    }

    // Suspend team member
    async suspendTeamMember(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const member = await TeamMember.findByIdAndUpdate(
                id,
                { status: 'suspended' },
                { new: true }
            ).populate('roleId', 'name description');

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: 'Team member not found',
                });
            }

            return res.json({
                success: true,
                data: member,
                message: 'Team member suspended successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to suspend team member',
                error: error.message,
            });
        }
    }

    // Reactivate team member
    async reactivateTeamMember(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const member = await TeamMember.findByIdAndUpdate(
                id,
                { status: 'active' },
                { new: true }
            ).populate('roleId', 'name description');

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: 'Team member not found',
                });
            }

            return res.json({
                success: true,
                data: member,
                message: 'Team member reactivated successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to reactivate team member',
                error: error.message,
            });
        }
    }

    // Remove team member
    async removeTeamMember(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const member = await TeamMember.findByIdAndUpdate(
                id,
                { status: 'removed' },
                { new: true }
            );

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: 'Team member not found',
                });
            }

            return res.json({
                success: true,
                message: 'Team member removed successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to remove team member',
                error: error.message,
            });
        }
    }

    // Resend invitation
    async resendInvitation(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const member = await TeamMember.findById(id);

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: 'Team member not found',
                });
            }

            if (member.status !== 'invited') {
                return res.status(400).json({
                    success: false,
                    message: 'Can only resend invitation to invited members',
                });
            }

            // Generate new token
            const token = (member as any).generateInvitationToken();
            await member.save();

            // Send invitation email
            await this.sendInvitationEmail(member, token);

            return res.json({
                success: true,
                message: 'Invitation resent successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to resend invitation',
                error: error.message,
            });
        }
    }

    // Helper: Send invitation email
    private async sendInvitationEmail(member: any, token: string) {
        try {
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: false,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });

            const invitationUrl = `${process.env.FRONTEND_URL}/accept-invite?token=${token}`;

            await transporter.sendMail({
                from: process.env.SMTP_FROM || 'noreply@example.com',
                to: member.email,
                subject: 'You\'ve been invited to join a team',
                html: `
                    <h2>Team Invitation</h2>
                    <p>Hi ${member.name},</p>
                    <p>You've been invited to join a team as a team member.</p>
                    <p><strong>Role:</strong> ${member.roleId?.name || 'Team Member'}</p>
                    <p>Click the link below to accept the invitation:</p>
                    <a href="${invitationUrl}" style="display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 6px;">Accept Invitation</a>
                    <p>This invitation will expire in 7 days.</p>
                    <p>If you didn't expect this invitation, you can safely ignore this email.</p>
                `,
            });
        } catch (error) {
            console.error('Failed to send invitation email:', error);
        }
    }
}

export const teamMemberController = new TeamMemberController();
