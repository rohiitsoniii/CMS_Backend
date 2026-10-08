import { Request, Response } from 'express';
import { EndUser } from '../models/EndUser';
import jwt from 'jsonwebtoken';
import { mailerService } from '../services/mailerService.js';
import { endUserLink } from '../services/endUserLinks.js';

export class EndUserController {
    // Register new end user (PUBLIC)
    async register(req: Request, res: Response) {
        try {
            const { projectId, email, password, firstName, lastName, phone, customFields } = req.body;

            if (!projectId || !email || !password || !firstName || !lastName) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                });
            }

            // Check if user already exists
            const existingUser = await EndUser.findOne({ projectId, email });
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'User with this email already exists',
                });
            }

            // Create user
            const user = await EndUser.create({
                projectId,
                email,
                password,
                firstName,
                lastName,
                phone,
                customFields: customFields || {},
                status: 'active',
                emailVerified: false,
            });

            // Generate verification token
            const verificationToken = user.generateEmailVerificationToken();
            await user.save();

            // Send verification email
            await this.sendVerificationEmail(user, verificationToken);

            // Generate JWT
            const token = this.generateToken(user);

            return res.status(201).json({
                success: true,
                data: {
                    user: {
                        id: user._id,
                        email: user.email,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        emailVerified: user.emailVerified,
                    },
                    token,
                },
                message: 'User registered successfully. Please check your email to verify your account.',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to register user',
                error: error.message,
            });
        }
    }

    // Login end user (PUBLIC)
    async login(req: Request, res: Response) {
        try {
            const { projectId, email, password } = req.body;

            if (!projectId || !email || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                });
            }

            // Find user
            const user = await EndUser.findOne({ projectId, email }).select('+password');

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid credentials',
                });
            }

            // Check if suspended
            if (user.status === 'suspended') {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has been suspended',
                });
            }

            // Verify password
            const isMatch = await user.comparePassword(password);
            if (!isMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid credentials',
                });
            }

            // Update login info
            user.lastLoginAt = new Date();
            user.loginCount += 1;
            await user.save();

            // Generate JWT
            const token = this.generateToken(user);

            return res.json({
                success: true,
                data: {
                    user: {
                        id: user._id,
                        email: user.email,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        avatar: user.avatar,
                        emailVerified: user.emailVerified,
                    },
                    token,
                },
                message: 'Login successful',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to login',
                error: error.message,
            });
        }
    }

    // Get user profile
    async getProfile(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;

            const user = await EndUser.findById(userId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            return res.json({
                success: true,
                data: user,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch profile',
                error: error.message,
            });
        }
    }

    // Update user profile
    async updateProfile(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { firstName, lastName, phone, dateOfBirth, address, avatar, customFields } = req.body;

            const user = await EndUser.findByIdAndUpdate(
                userId,
                {
                    firstName,
                    lastName,
                    phone,
                    dateOfBirth,
                    address,
                    avatar,
                    customFields,
                },
                { new: true, runValidators: true }
            );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            return res.json({
                success: true,
                data: user,
                message: 'Profile updated successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to update profile',
                error: error.message,
            });
        }
    }

    // Forgot password (PUBLIC)
    async forgotPassword(req: Request, res: Response) {
        try {
            const { projectId, email } = req.body;

            if (!projectId || !email) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                });
            }

            const user = await EndUser.findOne({ projectId, email });

            if (!user) {
                // Don't reveal if user exists
                return res.json({
                    success: true,
                    message: 'If the email exists, a password reset link has been sent',
                });
            }

            // Generate reset token
            const resetToken = user.generatePasswordResetToken();
            await user.save();

            // Send reset email
            await this.sendPasswordResetEmail(user, resetToken);

            return res.json({
                success: true,
                message: 'If the email exists, a password reset link has been sent',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to process request',
                error: error.message,
            });
        }
    }

    // Reset password (PUBLIC)
    async resetPassword(req: Request, res: Response) {
        try {
            const { token, password } = req.body;

            if (!token || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                });
            }

            const user = await (EndUser as any).findByResetToken(token);

            if (!user) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired reset token',
                });
            }

            // Update password
            user.password = password;
            user.passwordResetToken = undefined;
            user.passwordResetExpiry = undefined;
            await user.save();

            return res.json({
                success: true,
                message: 'Password reset successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to reset password',
                error: error.message,
            });
        }
    }

    // Verify email (PUBLIC)
    async verifyEmail(req: Request, res: Response) {
        try {
            const { token } = req.body;

            if (!token) {
                return res.status(400).json({
                    success: false,
                    message: 'Verification token is required',
                });
            }

            const user = await (EndUser as any).findByVerificationToken(token);

            if (!user) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid verification token',
                });
            }

            user.emailVerified = true;
            user.emailVerificationToken = undefined;
            await user.save();

            return res.json({
                success: true,
                message: 'Email verified successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to verify email',
                error: error.message,
            });
        }
    }

    // List all users (ADMIN)
    async listUsers(req: Request, res: Response) {
        try {
            const { projectId, status, page = 1, limit = 50 } = req.query;

            if (!projectId) {
                return res.status(400).json({
                    success: false,
                    message: 'Project ID is required',
                });
            }

            const filter: any = { projectId };
            if (status) filter.status = status;

            const skip = (Number(page) - 1) * Number(limit);

            const users = await EndUser.find(filter)
                .skip(skip)
                .limit(Number(limit))
                .sort({ createdAt: -1 });

            const total = await EndUser.countDocuments(filter);

            return res.json({
                success: true,
                data: users,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch users',
                error: error.message,
            });
        }
    }

    // Get user by ID (ADMIN)
    async getUserById(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const user = await EndUser.findById(id);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            return res.json({
                success: true,
                data: user,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch user',
                error: error.message,
            });
        }
    }

    // Suspend user (ADMIN)
    async suspendUser(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const user = await EndUser.findByIdAndUpdate(
                id,
                { status: 'suspended' },
                { new: true }
            );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            return res.json({
                success: true,
                data: user,
                message: 'User suspended successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to suspend user',
                error: error.message,
            });
        }
    }

    // Delete user (ADMIN)
    async deleteUser(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const user = await EndUser.findByIdAndUpdate(
                id,
                { status: 'deleted' },
                { new: true }
            );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            return res.json({
                success: true,
                message: 'User deleted successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to delete user',
                error: error.message,
            });
        }
    }

    // Helper: Generate JWT token
    private generateToken(user: any): string {
        return jwt.sign(
            {
                id: user._id,
                email: user.email,
                projectId: user.projectId,
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );
    }

    // Helper: Send verification email
    private async sendVerificationEmail(user: any, token: string) {
        try {
            const verificationUrl = await endUserLink(user.projectId, 'verifyEmail', token);

            // End-user mail goes through the project's own SMTP when configured
            await mailerService.send({
                projectId: user.projectId,
                category: 'transactional',
                throwOnError: true,
                to: user.email,
                subject: 'Verify your email address',
                html: `
                    <h2>Email Verification</h2>
                    <p>Hi ${user.firstName},</p>
                    <p>Thank you for registering! Please verify your email address by clicking the link below:</p>
                    <a href="${verificationUrl}" style="display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 6px;">Verify Email</a>
                    <p>If you didn't create an account, you can safely ignore this email.</p>
                `,
            });
        } catch (error) {
            console.error('Failed to send verification email:', error);
        }
    }

    // Helper: Send password reset email
    private async sendPasswordResetEmail(user: any, token: string) {
        try {
            const resetUrl = await endUserLink(user.projectId, 'resetPassword', token);

            await mailerService.send({
                projectId: user.projectId,
                category: 'transactional',
                throwOnError: true,
                to: user.email,
                subject: 'Reset your password',
                html: `
                    <h2>Password Reset</h2>
                    <p>Hi ${user.firstName},</p>
                    <p>You requested to reset your password. Click the link below to reset it:</p>
                    <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 6px;">Reset Password</a>
                    <p>This link will expire in 1 hour.</p>
                    <p>If you didn't request this, you can safely ignore this email.</p>
                `,
            });
        } catch (error) {
            console.error('Failed to send password reset email:', error);
        }
    }
}

export const endUserController = new EndUserController();
