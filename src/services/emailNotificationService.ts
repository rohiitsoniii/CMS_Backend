import nodemailer from 'nodemailer';
import { User } from '../models/User';
import { Content } from '../models/Content';
import { Workflow } from '../models/Workflow';

export class EmailNotificationService {
  private static transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  // Send workflow approval request
  static async sendApprovalRequest(workflowId: string, approverId: string, contentId: string) {
    const approver = await User.findById(approverId);
    const content = await Content.findById(contentId);
    const workflow = await Workflow.findById(workflowId);

    if (!approver || !content || !workflow) return;

    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@headlesscms.com',
      to: approver.email,
      subject: `Approval Required: ${content.data?.title || 'Content'}`,
      html: `
        <h2>Content Approval Request</h2>
        <p>Hi ${approver.name},</p>
        <p>You have been requested to approve the following content:</p>
        <ul>
          <li><strong>Title:</strong> ${content.data?.title || 'Untitled'}</li>
          <li><strong>Workflow:</strong> ${workflow.name}</li>
          <li><strong>Status:</strong> ${content.status}</li>
        </ul>
        <p><a href="${process.env.FRONTEND_URL}/dashboard/content/${contentId}">Review Content</a></p>
      `
    };

    await this.transporter.sendMail(mailOptions);
  }

  // Send content published notification
  static async sendPublishedNotification(contentId: string, recipients: string[]) {
    const content = await Content.findById(contentId);
    if (!content) return;

    const users = await User.find({ _id: { $in: recipients } });

    for (const user of users) {
      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@headlesscms.com',
        to: user.email,
        subject: `Content Published: ${content.data?.title || 'Content'}`,
        html: `
          <h2>Content Published</h2>
          <p>Hi ${user.name},</p>
          <p>The following content has been published:</p>
          <ul>
            <li><strong>Title:</strong> ${content.data?.title || 'Untitled'}</li>
            <li><strong>Published At:</strong> ${content.publishedAt}</li>
          </ul>
          <p><a href="${process.env.FRONTEND_URL}/dashboard/content/${contentId}">View Content</a></p>
        `
      };

      await this.transporter.sendMail(mailOptions);
    }
  }

  // Send scheduled content alert
  static async sendScheduledAlert(contentId: string, scheduledFor: Date) {
    const content = await Content.findById(contentId).populate('createdBy');
    if (!content) return;

    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@headlesscms.com',
      to: (content.createdBy as any).email,
      subject: `Scheduled Content Alert: ${content.data?.title || 'Content'}`,
      html: `
        <h2>Scheduled Content Alert</h2>
        <p>Your content is scheduled to be published:</p>
        <ul>
          <li><strong>Title:</strong> ${content.data?.title || 'Untitled'}</li>
          <li><strong>Scheduled For:</strong> ${scheduledFor}</li>
        </ul>
        <p><a href="${process.env.FRONTEND_URL}/dashboard/content/${contentId}">View Content</a></p>
      `
    };

    await this.transporter.sendMail(mailOptions);
  }

  // Send team invitation
  static async sendTeamInvitation(email: string, inviterName: string, projectName: string, inviteToken: string) {
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@headlesscms.com',
      to: email,
      subject: `You've been invited to join ${projectName}`,
      html: `
        <h2>Team Invitation</h2>
        <p>${inviterName} has invited you to join the project: <strong>${projectName}</strong></p>
        <p><a href="${process.env.FRONTEND_URL}/invite/${inviteToken}">Accept Invitation</a></p>
        <p>This invitation will expire in 7 days.</p>
      `
    };

    await this.transporter.sendMail(mailOptions);
  }

  // Send password reset
  static async sendPasswordReset(email: string, resetToken: string) {
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@headlesscms.com',
      to: email,
      subject: 'Password Reset Request',
      html: `
        <h2>Password Reset</h2>
        <p>You requested a password reset. Click the link below to reset your password:</p>
        <p><a href="${process.env.FRONTEND_URL}/reset-password/${resetToken}">Reset Password</a></p>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `
    };

    await this.transporter.sendMail(mailOptions);
  }

  // Send weekly activity digest
  static async sendWeeklyDigest(userId: string, activities: any[]) {
    const user = await User.findById(userId);
    if (!user) return;

    const activityList = activities.map(a => 
      `<li>${a.action} - ${a.description} (${new Date(a.createdAt).toLocaleDateString()})</li>`
    ).join('');

    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@headlesscms.com',
      to: user.email,
      subject: 'Your Weekly Activity Digest',
      html: `
        <h2>Weekly Activity Digest</h2>
        <p>Hi ${user.name},</p>
        <p>Here's a summary of your activity this week:</p>
        <ul>${activityList}</ul>
        <p><a href="${process.env.FRONTEND_URL}/dashboard">Go to Dashboard</a></p>
      `
    };

    await this.transporter.sendMail(mailOptions);
  }

  // Send comment mention notification
  static async sendCommentMention(mentionedUserId: string, commentAuthor: string, contentId: string, comment: string) {
    const user = await User.findById(mentionedUserId);
    if (!user) return;

    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@headlesscms.com',
      to: user.email,
      subject: `${commentAuthor} mentioned you in a comment`,
      html: `
        <h2>You were mentioned</h2>
        <p>${commentAuthor} mentioned you in a comment:</p>
        <blockquote>${comment}</blockquote>
        <p><a href="${process.env.FRONTEND_URL}/dashboard/content/${contentId}">View Content</a></p>
      `
    };

    await this.transporter.sendMail(mailOptions);
  }

  // Test email configuration
  static async testConnection() {
    try {
      await this.transporter.verify();
      return { success: true, message: 'Email configuration is valid' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
}
