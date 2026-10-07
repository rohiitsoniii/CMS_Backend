import { Request, Response } from 'express';
import { EmailCampaign } from '../models/EmailCampaign';
import { CampaignRecipient } from '../models/CampaignRecipient';
import { EmailSubscriber } from '../models/EmailSubscriber';
import nodemailer from 'nodemailer';

export class EmailCampaignController {
    // Get all campaigns for a project
    async getCampaigns(req: Request, res: Response) {
        try {
            const { projectId, status } = req.query;

            if (!projectId) {
                return res.status(400).json({
                    success: false,
                    message: 'Project ID is required',
                });
            }

            const filter: any = { projectId };
            if (status) filter.status = status;

            const campaigns = await EmailCampaign.find(filter)
                .populate('createdBy', 'name email')
                .populate('templateId', 'name')
                .sort({ createdAt: -1 });

            return res.json({
                success: true,
                data: campaigns,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch campaigns',
                error: error.message,
            });
        }
    }

    // Get single campaign
    async getCampaign(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const campaign = await EmailCampaign.findById(id)
                .populate('createdBy', 'name email')
                .populate('templateId');

            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found',
                });
            }

            return res.json({
                success: true,
                data: campaign,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch campaign',
                error: error.message,
            });
        }
    }

    // Create campaign
    async createCampaign(req: Request, res: Response) {
        try {
            const {
                projectId,
                name,
                subject,
                templateId,
                htmlContent,
                textContent,
                recipientType,
                recipientSegment,
                customRecipients,
                fromName,
                fromEmail,
                replyTo,
                trackOpens,
                trackClicks,
            } = req.body;
            const userId = (req as any).user.id;

            if (!projectId || !name || !subject || !htmlContent || !fromName || !fromEmail) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                });
            }

            const campaign = await EmailCampaign.create({
                projectId,
                name,
                subject,
                templateId,
                htmlContent,
                textContent,
                recipientType: recipientType || 'all',
                recipientSegment,
                customRecipients,
                status: 'draft',
                fromName,
                fromEmail,
                replyTo,
                trackOpens: trackOpens !== undefined ? trackOpens : true,
                trackClicks: trackClicks !== undefined ? trackClicks : true,
                stats: {
                    totalRecipients: 0,
                    sent: 0,
                    delivered: 0,
                    opened: 0,
                    clicked: 0,
                    bounced: 0,
                    unsubscribed: 0,
                    failed: 0,
                },
                createdBy: userId,
            });

            return res.status(201).json({
                success: true,
                data: campaign,
                message: 'Campaign created successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to create campaign',
                error: error.message,
            });
        }
    }

    // Update campaign
    async updateCampaign(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const updateData = req.body;

            // Don't allow updating sent campaigns
            const existingCampaign = await EmailCampaign.findById(id);
            if (existingCampaign?.status === 'sent') {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot update sent campaign',
                });
            }

            const campaign = await EmailCampaign.findByIdAndUpdate(
                id,
                updateData,
                { new: true, runValidators: true }
            );

            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found',
                });
            }

            return res.json({
                success: true,
                data: campaign,
                message: 'Campaign updated successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to update campaign',
                error: error.message,
            });
        }
    }

    // Delete campaign
    async deleteCampaign(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const campaign = await EmailCampaign.findByIdAndDelete(id);

            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found',
                });
            }

            // Delete associated recipients
            await CampaignRecipient.deleteMany({ campaignId: id });

            return res.json({
                success: true,
                message: 'Campaign deleted successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to delete campaign',
                error: error.message,
            });
        }
    }

    // Send campaign
    async sendCampaign(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const campaign = await EmailCampaign.findById(id);

            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found',
                });
            }

            if (campaign.status === 'sent') {
                return res.status(400).json({
                    success: false,
                    message: 'Campaign already sent',
                });
            }

            // Get recipients
            const recipients = await this.getRecipients(campaign);

            if (recipients.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No recipients found',
                });
            }

            // Create recipient records
            await CampaignRecipient.insertMany(
                recipients.map(email => ({
                    campaignId: campaign._id,
                    projectId: campaign.projectId,
                    email,
                    status: 'pending',
                    openCount: 0,
                    clickCount: 0,
                    clicks: [],
                }))
            );

            // Update campaign status
            campaign.status = 'sending';
            campaign.stats.totalRecipients = recipients.length;
            await campaign.save();

            // Send emails in background
            this.sendEmailsInBackground(campaign);

            return res.json({
                success: true,
                message: 'Campaign sending started',
                data: {
                    totalRecipients: recipients.length,
                },
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to send campaign',
                error: error.message,
            });
        }
    }

    // Schedule campaign
    async scheduleCampaign(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { scheduledFor } = req.body;

            if (!scheduledFor) {
                return res.status(400).json({
                    success: false,
                    message: 'Scheduled time is required',
                });
            }

            const campaign = await EmailCampaign.findByIdAndUpdate(
                id,
                {
                    status: 'scheduled',
                    scheduledFor: new Date(scheduledFor),
                },
                { new: true }
            );

            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found',
                });
            }

            return res.json({
                success: true,
                data: campaign,
                message: 'Campaign scheduled successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to schedule campaign',
                error: error.message,
            });
        }
    }

    // Pause campaign
    async pauseCampaign(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const campaign = await EmailCampaign.findByIdAndUpdate(
                id,
                { status: 'paused' },
                { new: true }
            );

            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found',
                });
            }

            return res.json({
                success: true,
                data: campaign,
                message: 'Campaign paused successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to pause campaign',
                error: error.message,
            });
        }
    }

    // Resume campaign
    async resumeCampaign(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const campaign = await EmailCampaign.findByIdAndUpdate(
                id,
                { status: 'sending' },
                { new: true }
            );

            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found',
                });
            }

            // Resume sending
            this.sendEmailsInBackground(campaign);

            return res.json({
                success: true,
                data: campaign,
                message: 'Campaign resumed successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to resume campaign',
                error: error.message,
            });
        }
    }

    // Get campaign statistics
    async getCampaignStats(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const campaign = await EmailCampaign.findById(id);

            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found',
                });
            }

            // Calculate rates
            const stats = {
                ...campaign.stats,
                deliveryRate: campaign.stats.totalRecipients > 0
                    ? (campaign.stats.delivered / campaign.stats.totalRecipients * 100).toFixed(2)
                    : 0,
                openRate: campaign.stats.delivered > 0
                    ? (campaign.stats.opened / campaign.stats.delivered * 100).toFixed(2)
                    : 0,
                clickRate: campaign.stats.delivered > 0
                    ? (campaign.stats.clicked / campaign.stats.delivered * 100).toFixed(2)
                    : 0,
                clickToOpenRate: campaign.stats.opened > 0
                    ? (campaign.stats.clicked / campaign.stats.opened * 100).toFixed(2)
                    : 0,
            };

            return res.json({
                success: true,
                data: stats,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch statistics',
                error: error.message,
            });
        }
    }

    // Get campaign recipients
    async getCampaignRecipients(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { status, page = 1, limit = 50 } = req.query;

            const filter: any = { campaignId: id };
            if (status) filter.status = status;

            const skip = (Number(page) - 1) * Number(limit);

            const recipients = await CampaignRecipient.find(filter)
                .skip(skip)
                .limit(Number(limit))
                .sort({ createdAt: -1 });

            const total = await CampaignRecipient.countDocuments(filter);

            return res.json({
                success: true,
                data: recipients,
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
                message: 'Failed to fetch recipients',
                error: error.message,
            });
        }
    }

    // Helper: Get recipients based on campaign settings
    private async getRecipients(campaign: any): Promise<string[]> {
        if (campaign.recipientType === 'custom' && campaign.customRecipients) {
            return campaign.customRecipients;
        }

        const filter: any = { projectId: campaign.projectId, status: 'subscribed' };

        if (campaign.recipientType === 'segment' && campaign.recipientSegment) {
            if (campaign.recipientSegment.tags?.length > 0) {
                filter.tags = { $in: campaign.recipientSegment.tags };
            }
        }

        const subscribers = await EmailSubscriber.find(filter).select('email');
        return subscribers.map(s => s.email);
    }

    // Helper: Send emails in background
    private async sendEmailsInBackground(campaign: any) {
        try {
            const recipients = await CampaignRecipient.find({
                campaignId: campaign._id,
                status: 'pending',
            });

            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: false,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });

            // Send in batches of 100
            const batchSize = 100;
            for (let i = 0; i < recipients.length; i += batchSize) {
                const batch = recipients.slice(i, i + batchSize);

                await Promise.all(
                    batch.map(async (recipient) => {
                        try {
                            await transporter.sendMail({
                                from: `${campaign.fromName} <${campaign.fromEmail}>`,
                                to: recipient.email,
                                subject: campaign.subject,
                                html: campaign.htmlContent,
                                text: campaign.textContent,
                            });

                            await CampaignRecipient.findByIdAndUpdate(recipient._id, {
                                status: 'sent',
                                sentAt: new Date(),
                            });

                            await EmailCampaign.findByIdAndUpdate(campaign._id, {
                                $inc: { 'stats.sent': 1 },
                            });
                        } catch (error) {
                            await CampaignRecipient.findByIdAndUpdate(recipient._id, {
                                status: 'failed',
                                error: (error as Error).message,
                            });

                            await EmailCampaign.findByIdAndUpdate(campaign._id, {
                                $inc: { 'stats.failed': 1 },
                            });
                        }
                    })
                );

                // Rate limiting: wait 1 second between batches
                if (i + batchSize < recipients.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // Update campaign status
            await EmailCampaign.findByIdAndUpdate(campaign._id, {
                status: 'sent',
                sentAt: new Date(),
            });
        } catch (error) {
            console.error('Failed to send campaign emails:', error);
        }
    }
}

export const emailCampaignController = new EmailCampaignController();
