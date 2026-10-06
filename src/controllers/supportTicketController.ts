import { Request, Response } from 'express';
import { SupportTicket } from '../models/SupportTicket';
import { EmailTemplate } from '../models/EmailTemplate';
import nodemailer from 'nodemailer';

export class SupportTicketController {
    // Get all tickets for a project
    async getTickets(req: Request, res: Response) {
        try {
            const { projectId, status, category, priority, assignedTo } = req.query;

            if (!projectId) {
                return res.status(400).json({
                    success: false,
                    message: 'Project ID is required',
                });
            }

            const filter: any = { projectId };
            if (status) filter.status = status;
            if (category) filter.category = category;
            if (priority) filter.priority = priority;
            if (assignedTo) filter.assignedTo = assignedTo;

            const tickets = await SupportTicket.find(filter)
                .populate('assignedTo', 'name email')
                .sort({ createdAt: -1 });

            res.json({
                success: true,
                data: tickets,
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to fetch tickets',
                error: error.message,
            });
        }
    }

    // Get single ticket
    async getTicket(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const ticket = await SupportTicket.findById(id)
                .populate('assignedTo', 'name email');

            if (!ticket) {
                return res.status(404).json({
                    success: false,
                    message: 'Ticket not found',
                });
            }

            res.json({
                success: true,
                data: ticket,
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to fetch ticket',
                error: error.message,
            });
        }
    }

    // Create ticket (public endpoint)
    async createTicket(req: Request, res: Response) {
        try {
            const {
                projectId,
                customerName,
                customerEmail,
                customerPhone,
                subject,
                message,
                category,
                priority,
            } = req.body;

            if (!projectId || !customerName || !customerEmail || !subject || !message) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                });
            }

            // Generate ticket number
            const ticketNumber = await (SupportTicket as any).generateTicketNumber();

            const ticket = await SupportTicket.create({
                projectId,
                ticketNumber,
                customerName,
                customerEmail,
                customerPhone,
                subject,
                message,
                category: category || 'general',
                priority: priority || 'medium',
                status: 'open',
                source: 'website',
                replies: [],
                tags: [],
                attachments: [],
            });

            // Send confirmation email to customer
            await this.sendConfirmationEmail(ticket);

            // Notify staff
            await this.notifyStaff(ticket);

            res.status(201).json({
                success: true,
                data: ticket,
                message: 'Ticket created successfully',
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to create ticket',
                error: error.message,
            });
        }
    }

    // Update ticket
    async updateTicket(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { subject, category, priority, status, tags } = req.body;

            const ticket = await SupportTicket.findByIdAndUpdate(
                id,
                {
                    subject,
                    category,
                    priority,
                    status,
                    tags,
                    ...(status === 'resolved' && { resolvedAt: new Date() }),
                    ...(status === 'closed' && { closedAt: new Date() }),
                },
                { new: true, runValidators: true }
            );

            if (!ticket) {
                return res.status(404).json({
                    success: false,
                    message: 'Ticket not found',
                });
            }

            res.json({
                success: true,
                data: ticket,
                message: 'Ticket updated successfully',
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to update ticket',
                error: error.message,
            });
        }
    }

    // Delete ticket
    async deleteTicket(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const ticket = await SupportTicket.findByIdAndDelete(id);

            if (!ticket) {
                return res.status(404).json({
                    success: false,
                    message: 'Ticket not found',
                });
            }

            res.json({
                success: true,
                message: 'Ticket deleted successfully',
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to delete ticket',
                error: error.message,
            });
        }
    }

    // Add reply to ticket
    async addReply(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { message, isStaffReply, repliedBy, attachments } = req.body;

            if (!message || isStaffReply === undefined || !repliedBy) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                });
            }

            const ticket = await SupportTicket.findByIdAndUpdate(
                id,
                {
                    $push: {
                        replies: {
                            message,
                            isStaffReply,
                            repliedBy,
                            repliedAt: new Date(),
                            attachments: attachments || [],
                        },
                    },
                    status: isStaffReply ? 'in_progress' : 'waiting',
                },
                { new: true }
            );

            if (!ticket) {
                return res.status(404).json({
                    success: false,
                    message: 'Ticket not found',
                });
            }

            // Send email notification
            if (isStaffReply) {
                await this.notifyCustomer(ticket, message);
            } else {
                await this.notifyStaff(ticket);
            }

            res.json({
                success: true,
                data: ticket,
                message: 'Reply added successfully',
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to add reply',
                error: error.message,
            });
        }
    }

    // Assign ticket to staff
    async assignTicket(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { assignedTo } = req.body;

            const ticket = await SupportTicket.findByIdAndUpdate(
                id,
                {
                    assignedTo,
                    status: 'in_progress',
                },
                { new: true }
            ).populate('assignedTo', 'name email');

            if (!ticket) {
                return res.status(404).json({
                    success: false,
                    message: 'Ticket not found',
                });
            }

            res.json({
                success: true,
                data: ticket,
                message: 'Ticket assigned successfully',
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to assign ticket',
                error: error.message,
            });
        }
    }

    // Update ticket status
    async updateStatus(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!status) {
                return res.status(400).json({
                    success: false,
                    message: 'Status is required',
                });
            }

            const updateData: any = { status };
            if (status === 'resolved') {
                updateData.resolvedAt = new Date();
            } else if (status === 'closed') {
                updateData.closedAt = new Date();
            }

            const ticket = await SupportTicket.findByIdAndUpdate(
                id,
                updateData,
                { new: true }
            );

            if (!ticket) {
                return res.status(404).json({
                    success: false,
                    message: 'Ticket not found',
                });
            }

            // Send notification if resolved
            if (status === 'resolved') {
                await this.sendResolvedEmail(ticket);
            }

            res.json({
                success: true,
                data: ticket,
                message: 'Status updated successfully',
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: 'Failed to update status',
                error: error.message,
            });
        }
    }

    // Helper: Send confirmation email
    private async sendConfirmationEmail(ticket: any) {
        try {
            const transporter = nodemailer.createTransporter({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: false,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });

            await transporter.sendMail({
                from: process.env.SMTP_FROM || 'support@example.com',
                to: ticket.customerEmail,
                subject: `Ticket Created: ${ticket.ticketNumber}`,
                html: `
                    <h2>Support Ticket Created</h2>
                    <p>Hi ${ticket.customerName},</p>
                    <p>Your support ticket has been created successfully.</p>
                    <p><strong>Ticket Number:</strong> ${ticket.ticketNumber}</p>
                    <p><strong>Subject:</strong> ${ticket.subject}</p>
                    <p>We'll get back to you as soon as possible.</p>
                `,
            });
        } catch (error) {
            console.error('Failed to send confirmation email:', error);
        }
    }

    // Helper: Notify staff
    private async notifyStaff(ticket: any) {
        // Implementation depends on your notification system
        console.log('Notifying staff about ticket:', ticket.ticketNumber);
    }

    // Helper: Notify customer
    private async notifyCustomer(ticket: any, message: string) {
        try {
            const transporter = nodemailer.createTransporter({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: false,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });

            await transporter.sendMail({
                from: process.env.SMTP_FROM || 'support@example.com',
                to: ticket.customerEmail,
                subject: `Re: ${ticket.ticketNumber} - ${ticket.subject}`,
                html: `
                    <h2>New Reply to Your Ticket</h2>
                    <p>Hi ${ticket.customerName},</p>
                    <p>We've replied to your support ticket.</p>
                    <p><strong>Ticket Number:</strong> ${ticket.ticketNumber}</p>
                    <div style="background: #f5f5f5; padding: 15px; margin: 20px 0;">
                        ${message}
                    </div>
                `,
            });
        } catch (error) {
            console.error('Failed to notify customer:', error);
        }
    }

    // Helper: Send resolved email
    private async sendResolvedEmail(ticket: any) {
        try {
            const transporter = nodemailer.createTransporter({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: false,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });

            await transporter.sendMail({
                from: process.env.SMTP_FROM || 'support@example.com',
                to: ticket.customerEmail,
                subject: `Ticket Resolved: ${ticket.ticketNumber}`,
                html: `
                    <h2>Ticket Resolved</h2>
                    <p>Hi ${ticket.customerName},</p>
                    <p>Your support ticket has been resolved.</p>
                    <p><strong>Ticket Number:</strong> ${ticket.ticketNumber}</p>
                    <p>If you have any further questions, please don't hesitate to reach out.</p>
                `,
            });
        } catch (error) {
            console.error('Failed to send resolved email:', error);
        }
    }
}

export const supportTicketController = new SupportTicketController();
