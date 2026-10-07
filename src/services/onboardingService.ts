import nodemailer from 'nodemailer';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import ContentType from '../models/ContentType.js';

export class OnboardingService {
  private static transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  static async sendWelcomeEmail(userId: string) {
    const user = await User.findById(userId).populate('tenantId');
    if (!user) return;

    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@headlesscms.com',
      to: user.email,
      subject: 'Welcome to Headless CMS - Get Started!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 20px; text-align: center; border-radius: 12px 12px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 12px 12px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .features { display: flex; gap: 15px; margin: 20px 0; }
            .feature { flex: 1; background: white; padding: 15px; border-radius: 8px; text-align: center; }
            .steps { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .step { display: flex; align-items: center; gap: 15px; margin: 10px 0; }
            .step-number { background: #667eea; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Welcome to Headless CMS!</h1>
              <p>Your account has been created successfully</p>
            </div>
            <div class="content">
              <p>Hi ${(user as any).fullName || (user as any).firstName || 'there'},</p>
              <p>Welcome to Headless CMS! We're excited to have you on board. Here's everything you need to get started:</p>
              
              <div class="features">
                <div class="feature">
                  <h3>📝</h3>
                  <p>Create Content</p>
                </div>
                <div class="feature">
                  <h3>🌐</h3>
                  <p>API Delivery</p>
                </div>
                <div class="feature">
                  <h3>👥</h3>
                  <p>Team Collaboration</p>
                </div>
              </div>
              
              <div class="steps">
                <h3>🚀 Quick Start Guide</h3>
                <div class="step">
                  <span class="step-number">1</span>
                  <span>Create your first project</span>
                </div>
                <div class="step">
                  <span class="step-number">2</span>
                  <span>Define content types (blog, product, etc.)</span>
                </div>
                <div class="step">
                  <span class="step-number">3</span>
                  <span>Add content and publish</span>
                </div>
                <div class="step">
                  <span class="step-number">4</span>
                  <span>Use our API to deliver to your apps</span>
                </div>
              </div>
              
              <a href="${process.env.FRONTEND_URL}/dashboard" class="button">Go to Dashboard</a>
              
              <p>Need help? Reply to this email or check our <a href="${process.env.FRONTEND_URL}/docs">documentation</a>.</p>
            </div>
            <div class="footer">
              <p>Thanks,<br>The Headless CMS Team</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await this.transporter.sendMail(mailOptions);
  }

  static async sendFollowUpEmail(userId: string, daysAfterSignup: number) {
    const user = await User.findById(userId);
    if (!user) return;

    const templates: { [key: number]: { subject: string; content: string } } = {
      1: {
        subject: 'Getting Started with Headless CMS - Day 1',
        content: `
          <p>Hi ${(user as any).fullName || (user as any).firstName || 'there'},</p>
          <p>Day 1 is here! Let's get you set up with your first project.</p>
          <ul>
            <li>Create a new project in your dashboard</li>
            <li>Try our pre-built content types (Blog Post, Product, Page)</li>
            <li>Add some sample content to see how it works</li>
          </ul>
          <p><a href="${process.env.FRONTEND_URL}/dashboard/projects/new">Create Your First Project</a></p>
        `
      },
      3: {
        subject: 'Tips for Getting the Most Out of Headless CMS',
        content: `
          <p>Hi ${(user as any).fullName || (user as any).firstName || 'there'},</p>
          <p>By now you should have a good grasp of the basics. Here are some pro tips:</p>
          <ul>
            <li><strong>Use Content Types:</strong> Define reusable schemas for your content</li>
            <li><strong>Invite Your Team:</strong> Collaborate with your team members</li>
            <li><strong>Explore the API:</strong> Use our REST or GraphQL API to fetch content</li>
            <li><strong>Set Up Webhooks:</strong> Automate actions when content changes</li>
          </ul>
        `
      },
      7: {
        subject: 'One Week In - How Are You Doing?',
        content: `
          <p>Hi ${(user as any).fullName || (user as any).firstName || 'there'},</p>
          <p>It's been a week since you joined us! We'd love to hear how your experience has been.</p>
          <p>Have questions? Our support team is here to help.</p>
          <p><a href="${process.env.FRONTEND_URL}/dashboard/support">Contact Support</a></p>
        `
      }
    };

    const template = templates[daysAfterSignup];
    if (!template) return;

    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@headlesscms.com',
      to: user.email,
      subject: template.subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 12px; }
            a { color: #667eea; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              ${template.content}
              <p>Thanks,<br>The Headless CMS Team</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await this.transporter.sendMail(mailOptions);
  }

  static async createSampleProject(tenantId: string, userId: string) {
    const sampleProject = await Project.create({
      name: 'Sample Blog',
      description: 'A sample blog project to get you started',
      tenantId,
      createdBy: userId,
      settings: {
        defaultLocale: 'en',
        allowPublicAccess: true
      }
    });

    const contentTypes = [
      {
        name: 'Blog Post',
        fields: [
          { name: 'title', type: 'text', required: true },
          { name: 'slug', type: 'text', required: true },
          { name: 'content', type: 'richtext' },
          { name: 'excerpt', type: 'text' },
          { name: 'featuredImage', type: 'media' },
          { name: 'author', type: 'text' },
          { name: 'publishedAt', type: 'datetime' },
          { name: 'status', type: 'select', options: ['draft', 'published', 'archived'] }
        ],
        tenantId,
        projectId: sampleProject._id
      },
      {
        name: 'Product',
        fields: [
          { name: 'name', type: 'text', required: true },
          { name: 'description', type: 'richtext' },
          { name: 'price', type: 'number' },
          { name: 'image', type: 'media' },
          { name: 'category', type: 'text' },
          { name: 'inStock', type: 'boolean' }
        ],
        tenantId,
        projectId: sampleProject._id
      }
    ];

    await ContentType.insertMany(contentTypes);

    return sampleProject;
  }

  static async sendOnboardingSurvey(userId: string) {
    const user = await User.findById(userId);
    if (!user) return;

    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@headlesscms.com',
      to: user.email,
      subject: 'Help Us Improve - Quick Survey',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 12px; text-align: center; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <h2> We'd Love Your Feedback!</h2>
              <p>You've been using Headless CMS for a while now. Help us make it better!</p>
              <a href="${process.env.FRONTEND_URL}/survey" class="button">Take 2-Minute Survey</a>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await this.transporter.sendMail(mailOptions);
  }
}