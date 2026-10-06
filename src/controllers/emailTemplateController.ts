import { Request, Response } from 'express';
import { EmailTemplate } from '../models/EmailTemplate';
import nodemailer from 'nodemailer';

export class EmailTemplateController {
    // Get all templates for a project
    async getTemplates(req: Request, res: Response) {
        try {
            const { projectId } = req.query;

            if (!projectId) {
                return res.status(400).json({
                    success: false,
                    message: 'Project ID is required',
                });
            }

            const templates = await EmailTemplate.find({ projectId })
                .populate('createdBy', 'name email')
                .sort({ createdAt: -1 });

            res.json({
                success: true,
                data: templates,
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to fetch templates',
                error: error.message,
            });
        }
    }

    // Get single template
    async getTemplate(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const template = await EmailTemplate.findById(id)
                .populate('createdBy', 'name email');

            if (!template) {
                return res.status(404).json({
                    success: false,
                    message: 'Template not found',
                });
            }

            res.json({
                success: true,
                data: template,
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to fetch template',
                error: error.message,
            });
        }
    }

    // Create template
    async createTemplate(req: Request, res: Response) {
        try {
            const { projectId, name, subject, body, variables, category, isActive } = req.body;
            const userId = (req as any).user.id;

            if (!projectId || !name || !subject || !body) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                });
            }

            const template = await EmailTemplate.create({
                projectId,
                name,
                subject,
                body,
                variables: variables || [],
                category: category || 'transactional',
                isActive: isActive !== undefined ? isActive : true,
                createdBy: userId,
            });

            res.status(201).json({
                success: true,
                data: template,
                message: 'Template created successfully',
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to create template',
                error: error.message,
            });
        }
    }

    // Update template
    async updateTemplate(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { name, subject, body, variables, category, isActive } = req.body;

            const template = await EmailTemplate.findByIdAndUpdate(
                id,
                {
                    name,
                    subject,
                    body,
                    variables,
                    category,
                    isActive,
                },
                { new: true, runValidators: true }
            );

            if (!template) {
                return res.status(404).json({
                    success: false,
                    message: 'Template not found',
                });
            }

            res.json({
                success: true,
                data: template,
                message: 'Template updated successfully',
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to update template',
                error: error.message,
            });
        }
    }

    // Delete template
    async deleteTemplate(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const template = await EmailTemplate.findByIdAndDelete(id);

            if (!template) {
                return res.status(404).json({
                    success: false,
                    message: 'Template not found',
                });
            }

            res.json({
                success: true,
                message: 'Template deleted successfully',
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to delete template',
                error: error.message,
            });
        }
    }

    // Preview template with test data
    async previewTemplate(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { variables } = req.body;

            const template = await EmailTemplate.findById(id);

            if (!template) {
                return res.status(404).json({
                    success: false,
                    message: 'Template not found',
                });
            }

            // Replace variables
            const preview = template.replaceVariables(variables || {});

            res.json({
                success: true,
                data: preview,
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to preview template',
                error: error.message,
            });
        }
    }

    // Send test email
    async sendTestEmail(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { email, variables } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: 'Email address is required',
                });
            }

            const template = await EmailTemplate.findById(id);

            if (!template) {
                return res.status(404).json({
                    success: false,
                    message: 'Template not found',
                });
            }

            // Replace variables
            const { subject, body } = template.replaceVariables(variables || {});

            // Create transporter (configure with your email service)
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: false,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });

            // Send email
            await transporter.sendMail({
                from: process.env.SMTP_FROM || 'noreply@example.com',
                to: email,
                subject: `[TEST] ${subject}`,
                html: body,
            });

            res.json({
                success: true,
                message: 'Test email sent successfully',
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to send test email',
                error: error.message,
            });
        }
    }
}

export const emailTemplateController = new EmailTemplateController();
