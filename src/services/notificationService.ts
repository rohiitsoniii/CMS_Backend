import { Types } from 'mongoose';
import { User, Content } from '../models/index.js';
import { TeamMember } from '../models/TeamMember.js';
import Workflow from '../models/Workflow.js';
import { Notification } from '../models/Notification.js';
import { mailerService } from './mailerService.js';
import { config } from '../config/index.js';
import collaborationService from './collaborationService.js';

interface EmailData {
  to: string;
  subject: string;
  html: string;
}

/**
 * Notification Service
 * Handles email notifications for various CMS events
 */
export class NotificationService {
  /**
   * Send a notification email to a CMS team member.
   * Internal notifications always use the platform mail server — never
   * another tenant's SMTP config.
   */
  private static async sendEmail(data: EmailData, _tenantId?: unknown): Promise<void> {
    try {
      await mailerService.send({
        category: 'system',
        to: data.to,
        subject: data.subject,
        html: data.html,
      });
    } catch (error) {
      console.error('❌ Error sending email:', error);
    }
  }

  /**
   * Create a DB notification and push it via WebSocket
   */
  static async createAndPush(data: {
    tenantId: Types.ObjectId;
    userId: Types.ObjectId;
    type: 'workflow' | 'mention' | 'quota' | 'system' | 'publishing';
    title: string;
    message: string;
    actionUrl?: string;
    metadata?: any;
    sendEmail?: boolean;
    emailTo?: string;
  }): Promise<void> {
    try {
      // 1. Save to DB
      const notification = await Notification.create({
        tenantId: data.tenantId,
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        actionUrl: data.actionUrl,
        metadata: data.metadata,
      });

      // 2. Push via WebSocket
      collaborationService.notifyUser(
        String(data.userId), 
        'notification:new', 
        notification
      );

      // 3. Send Email if requested
      if (data.sendEmail && data.emailTo) {
        // We'll use the existing templates
        // For simplicity in this generic method, we expect the caller to have sent HTML or use a generic one
        // But the existing notifyContentPublished etc methods will be updated to use this.
      }
    } catch (error) {
      console.error('Error in createAndPush:', error);
    }
  }

  /**
   * Notify when content is published
   */
  static async notifyContentPublished(
    contentId: Types.ObjectId,
    publishedBy: Types.ObjectId
  ): Promise<void> {
    try {
      const content = await Content.findById(contentId)
        .populate('projectId', 'name')
        .populate('createdBy', 'email firstName lastName');
      
      if (!content) return;

      const publisher = await User.findById(publishedBy);
      if (!publisher) return;

      // Notify content creator if different from publisher
      if (content.createdBy && String(content.createdBy._id) !== String(publishedBy)) {
        const creator = content.createdBy as any;
        
        await this.createAndPush({
          tenantId: content.tenantId as any,
          userId: creator._id,
          type: 'publishing',
          title: 'Content Published',
          message: `Your content "${content.name}" has been published by ${publisher.firstName} ${publisher.lastName}.`,
          actionUrl: `/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
        });

        await this.sendEmail({
          to: creator.email,
          subject: `Content Published: ${content.name}`,
          html: this.getPublishedTemplate({
            contentName: content.name,
            publisherName: `${publisher.firstName} ${publisher.lastName}`,
            projectName: (content.projectId as any).name,
            contentUrl: `${config.frontendUrl}/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
          }),
        }, String(content.tenantId));
      }

      // Notify team members
      const teamMembers = await TeamMember.find({
        projectId: content.projectId,
        userId: { $ne: publishedBy },
        notificationPreferences: { $in: ['all', 'content_published'] },
      }).populate('userId', 'email firstName lastName');

      for (const member of teamMembers) {
        const user = member.userId as any;
        await this.createAndPush({
          tenantId: content.tenantId as any,
          userId: user._id,
          type: 'publishing',
          title: 'New Content Published',
          message: `"${content.name}" was published in ${(content.projectId as any).name}`,
          actionUrl: `/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
        });

        await this.sendEmail({
          to: user.email,
          subject: `New Content Published: ${content.name}`,
          html: this.getPublishedTemplate({
            contentName: content.name,
            publisherName: `${publisher.firstName} ${publisher.lastName}`,
            projectName: (content.projectId as any).name,
            contentUrl: `${config.frontendUrl}/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
          }),
        }, String(content.tenantId));
      }
    } catch (error) {
      console.error('Error sending published notification:', error);
    }
  }

  /**
   * Notify when content needs approval
   */
  static async notifyWorkflowApproval(
    contentId: Types.ObjectId,
    workflowId: Types.ObjectId,
    requestedBy: Types.ObjectId
  ): Promise<void> {
    try {
      const [content, workflow, requester] = await Promise.all([
        Content.findById(contentId).populate('projectId', 'name'),
        Workflow.findById(workflowId).populate('steps.assignedTo', 'email firstName lastName'),
        User.findById(requestedBy),
      ]);

      if (!content || !workflow || !requester) return;

      // Find current step approvers
      const currentStep = (workflow.steps as any).find((step: any) => step.status === 'pending');
      if (!currentStep || !currentStep.assignedTo) return;

      const approvers = Array.isArray(currentStep.assignedTo) 
        ? currentStep.assignedTo 
        : [currentStep.assignedTo];

      for (const approver of approvers) {
        const user = approver as any;
        await this.createAndPush({
          tenantId: content.tenantId as any,
          userId: user._id,
          type: 'workflow',
          title: 'Approval Required',
          message: `${requester.firstName} ${requester.lastName} requested your approval for "${content.name}".`,
          actionUrl: `/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
        });

        await this.sendEmail({
          to: user.email,
          subject: `Approval Required: ${content.name}`,
          html: this.getApprovalTemplate({
            contentName: content.name,
            requesterName: `${requester.firstName} ${requester.lastName}`,
            projectName: (content.projectId as any).name,
            approvalUrl: `${config.frontendUrl}/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
            workflowName: workflow.name,
          }),
        }, String(content.tenantId));
      }
    } catch (error) {
      console.error('Error sending approval notification:', error);
    }
  }

  /**
   * Notify when content is scheduled
   */
  static async notifyContentScheduled(
    contentId: Types.ObjectId,
    scheduledDate: Date,
    scheduledBy: Types.ObjectId
  ): Promise<void> {
    try {
      const content = await Content.findById(contentId)
        .populate('projectId', 'name')
        .populate('createdBy', 'email firstName lastName');
      
      if (!content) return;

      const scheduler = await User.findById(scheduledBy);
      if (!scheduler) return;

      // Notify content creator
      if (content.createdBy) {
        const creator = content.createdBy as any;
        
        await this.createAndPush({
          tenantId: content.tenantId as any,
          userId: creator._id,
          type: 'publishing',
          title: 'Content Scheduled',
          message: `Your content "${content.name}" has been scheduled for ${scheduledDate.toLocaleString()}.`,
          actionUrl: `/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
        });

        await this.sendEmail({
          to: creator.email,
          subject: `Content Scheduled: ${content.name}`,
          html: this.getScheduledTemplate({
            contentName: content.name,
            schedulerName: `${scheduler.firstName} ${scheduler.lastName}`,
            projectName: (content.projectId as any).name,
            scheduledDate: scheduledDate.toLocaleString(),
            contentUrl: `${config.frontendUrl}/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
          }),
        }, String(content.tenantId));
      }
    } catch (error) {
      console.error('Error sending scheduled notification:', error);
    }
  }

  /**
   * Notify when workflow is approved
   */
  static async notifyWorkflowApproved(
    contentId: Types.ObjectId,
    approvedBy: Types.ObjectId
  ): Promise<void> {
    try {
      const content = await Content.findById(contentId)
        .populate('projectId', 'name')
        .populate('createdBy', 'email firstName lastName');
      
      if (!content) return;

      const approver = await User.findById(approvedBy);
      if (!approver) return;

      // Notify content creator
      if (content.createdBy) {
        const creator = content.createdBy as any;
        
        await this.createAndPush({
          tenantId: content.tenantId as any,
          userId: creator._id,
          type: 'workflow',
          title: 'Content Approved',
          message: `Great news! "${content.name}" has been approved by ${approver.firstName} ${approver.lastName}.`,
          actionUrl: `/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
        });

        await this.sendEmail({
          to: creator.email,
          subject: `Content Approved: ${content.name}`,
          html: this.getApprovedTemplate({
            contentName: content.name,
            approverName: `${approver.firstName} ${approver.lastName}`,
            projectName: (content.projectId as any).name,
            contentUrl: `${config.frontendUrl}/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
          }),
        }, String(content.tenantId));
      }
    } catch (error) {
      console.error('Error sending approved notification:', error);
    }
  }

  /**
   * Notify when workflow is rejected
   */
  static async notifyWorkflowRejected(
    contentId: Types.ObjectId,
    rejectedBy: Types.ObjectId,
    reason?: string
  ): Promise<void> {
    try {
      const content = await Content.findById(contentId)
        .populate('projectId', 'name')
        .populate('createdBy', 'email firstName lastName');
      
      if (!content) return;

      const rejector = await User.findById(rejectedBy);
      if (!rejector) return;

      // Notify content creator
      if (content.createdBy) {
        const creator = content.createdBy as any;
        
        await this.createAndPush({
          tenantId: content.tenantId as any,
          userId: creator._id,
          type: 'workflow',
          title: 'Content Rejected',
          message: `"${content.name}" was rejected by ${rejector.firstName} ${rejector.lastName}. Reason: ${reason || 'No reason provided'}`,
          actionUrl: `/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
        });

        await this.sendEmail({
          to: creator.email,
          subject: `Content Rejected: ${content.name}`,
          html: this.getRejectedTemplate({
            contentName: content.name,
            rejectorName: `${rejector.firstName} ${rejector.lastName}`,
            projectName: (content.projectId as any).name,
            reason: reason || 'No reason provided',
            contentUrl: `${config.frontendUrl}/dashboard/project/${content.projectId}/content/${content.contentTypeId}/${content._id}`,
          }),
        }, String(content.tenantId));
      }
    } catch (error) {
      console.error('Error sending rejected notification:', error);
    }
  }

  /**
   * Notify team member invitation
   */
  static async notifyTeamInvitation(
    email: string,
    projectName: string,
    invitedBy: string,
    role: string,
    inviteToken: string
  ): Promise<void> {
    try {
      await this.sendEmail({
        to: email,
        subject: `You've been invited to ${projectName}`,
        html: this.getInvitationTemplate({
          projectName,
          invitedBy,
          role,
          acceptUrl: `${config.frontendUrl}/accept-invite?token=${inviteToken}`,
        }),
      });
    } catch (error) {
      console.error('Error sending invitation notification:', error);
    }
  }

  // ============================
  // Email Templates
  // ============================

  private static getPublishedTemplate(data: {
    contentName: string;
    publisherName: string;
    projectName: string;
    contentUrl: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Content Published!</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p><strong>${data.publisherName}</strong> has published content in <strong>${data.projectName}</strong>:</p>
            <h2 style="color: #667eea;">${data.contentName}</h2>
            <p>The content is now live and visible to your audience.</p>
            <a href="${data.contentUrl}" class="button">View Content</a>
          </div>
          <div class="footer">
            <p>This is an automated notification from your Headless CMS</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private static getApprovalTemplate(data: {
    contentName: string;
    requesterName: string;
    projectName: string;
    approvalUrl: string;
    workflowName: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #f5576c; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⏰ Approval Required</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p><strong>${data.requesterName}</strong> has submitted content for approval in <strong>${data.projectName}</strong>:</p>
            <h2 style="color: #f5576c;">${data.contentName}</h2>
            <p><strong>Workflow:</strong> ${data.workflowName}</p>
            <p>Please review and approve or reject this content.</p>
            <a href="${data.approvalUrl}" class="button">Review Content</a>
          </div>
          <div class="footer">
            <p>This is an automated notification from your Headless CMS</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private static getScheduledTemplate(data: {
    contentName: string;
    schedulerName: string;
    projectName: string;
    scheduledDate: string;
    contentUrl: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #4facfe; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          .date-box { background: white; padding: 15px; border-left: 4px solid #4facfe; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📅 Content Scheduled</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p><strong>${data.schedulerName}</strong> has scheduled content in <strong>${data.projectName}</strong>:</p>
            <h2 style="color: #4facfe;">${data.contentName}</h2>
            <div class="date-box">
              <strong>Scheduled for:</strong> ${data.scheduledDate}
            </div>
            <p>The content will be automatically published at the scheduled time.</p>
            <a href="${data.contentUrl}" class="button">View Content</a>
          </div>
          <div class="footer">
            <p>This is an automated notification from your Headless CMS</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private static getApprovedTemplate(data: {
    contentName: string;
    approverName: string;
    projectName: string;
    contentUrl: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #11998e; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Content Approved!</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p>Great news! <strong>${data.approverName}</strong> has approved your content in <strong>${data.projectName}</strong>:</p>
            <h2 style="color: #11998e;">${data.contentName}</h2>
            <p>Your content is now ready to be published.</p>
            <a href="${data.contentUrl}" class="button">View Content</a>
          </div>
          <div class="footer">
            <p>This is an automated notification from your Headless CMS</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private static getRejectedTemplate(data: {
    contentName: string;
    rejectorName: string;
    projectName: string;
    reason: string;
    contentUrl: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ee0979 0%, #ff6a00 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #ee0979; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          .reason-box { background: white; padding: 15px; border-left: 4px solid #ee0979; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>❌ Content Rejected</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p><strong>${data.rejectorName}</strong> has rejected your content in <strong>${data.projectName}</strong>:</p>
            <h2 style="color: #ee0979;">${data.contentName}</h2>
            <div class="reason-box">
              <strong>Reason:</strong><br>
              ${data.reason}
            </div>
            <p>Please review the feedback and make the necessary changes.</p>
            <a href="${data.contentUrl}" class="button">Edit Content</a>
          </div>
          <div class="footer">
            <p>This is an automated notification from your Headless CMS</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private static getInvitationTemplate(data: {
    projectName: string;
    invitedBy: string;
    role: string;
    acceptUrl: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          .info-box { background: white; padding: 15px; border-left: 4px solid #667eea; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 You're Invited!</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p><strong>${data.invitedBy}</strong> has invited you to join:</p>
            <h2 style="color: #667eea;">${data.projectName}</h2>
            <div class="info-box">
              <strong>Your Role:</strong> ${data.role}
            </div>
            <p>Click the button below to accept the invitation and get started.</p>
            <a href="${data.acceptUrl}" class="button">Accept Invitation</a>
          </div>
          <div class="footer">
            <p>This invitation will expire in 7 days</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
