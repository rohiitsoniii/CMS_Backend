import { Request, Response } from 'express';
import { OnboardingService } from '../services/onboardingService.js';
import { User } from '../models/User.js';
import { Tenant } from '../models/Tenant.js';

export class OnboardingController {
  static async startOnboarding(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      
      await OnboardingService.sendWelcomeEmail(userId);
      
      res.json({
        success: true,
        message: 'Onboarding started. Welcome email sent.',
        nextSteps: [
          'Create your first project',
          'Invite team members',
          'Explore content types',
          'Set up API access'
        ]
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getOnboardingStatus(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const userId = req.user!.id;

      const tenant = await Tenant.findById(tenantId);
      const user = await User.findById(userId);

      const steps = [
        {
          id: 'welcome',
          title: 'Welcome Email',
          completed: true,
          description: 'Account created and welcome email sent'
        },
        {
          id: 'project',
          title: 'Create First Project',
          completed: tenant?.onboarding?.projectCreated || false,
          description: 'Set up your first content project'
        },
        {
          id: 'content-type',
          title: 'Define Content Types',
          completed: tenant?.onboarding?.contentTypesCreated || false,
          description: 'Create content schemas for your data'
        },
        {
          id: 'team',
          title: 'Invite Team Members',
          completed: tenant?.onboarding?.teamInvited || false,
          description: 'Collaborate with your team'
        },
        {
          id: 'api',
          title: 'Set Up API Access',
          completed: tenant?.onboarding?.apiKeyCreated || false,
          description: 'Generate API keys for content delivery'
        }
      ];

      const completedSteps = steps.filter(s => s.completed).length;
      const progress = Math.round((completedSteps / steps.length) * 100);

      res.json({
        progress,
        steps,
        user: {
          name: user?.name,
          email: user?.email,
          signupDate: user?.createdAt
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async completeStep(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const { step } = req.body;

      const updateFields: { [key: string]: boolean } = {};
      switch (step) {
        case 'project':
          updateFields['onboarding.projectCreated'] = true;
          break;
        case 'content-type':
          updateFields['onboarding.contentTypesCreated'] = true;
          break;
        case 'team':
          updateFields['onboarding.teamInvited'] = true;
          break;
        case 'api':
          updateFields['onboarding.apiKeyCreated'] = true;
          break;
        default:
          return res.status(400).json({ error: 'Invalid step' });
      }

      await Tenant.findByIdAndUpdate(tenantId, { $set: updateFields });

      res.json({ success: true, message: `Step "${step}" marked as complete` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async createSampleProject(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const userId = req.user!.id;

      const project = await OnboardingService.createSampleProject(tenantId, userId);

      await Tenant.findByIdAndUpdate(tenantId, {
        $set: { 'onboarding.projectCreated': true }
      });

      res.json({
        success: true,
        message: 'Sample project created',
        project: {
          id: project._id,
          name: project.name,
          description: project.description
        },
        contentTypes: ['Blog Post', 'Product']
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getQuickStartGuide(req: Request, res: Response) {
    try {
      res.json({
        steps: [
          {
            order: 1,
            title: 'Create a Project',
            description: 'Projects help you organize your content. Start with a blank project or use our templates.',
            link: '/dashboard/projects/new',
            icon: '📁'
          },
          {
            order: 2,
            title: 'Define Content Types',
            description: 'Content types define the structure of your content. Create types like Blog Post, Product, or Page.',
            link: '/dashboard/content-types',
            icon: '📝'
          },
          {
            order: 3,
            title: 'Add Content',
            description: 'Start adding content to your project. You can use our visual editor or import from other sources.',
            link: '/dashboard/content',
            icon: '✏️'
          },
          {
            order: 4,
            title: 'Set Up API Access',
            description: 'Generate API keys to fetch your content programmatically via REST or GraphQL.',
            link: '/dashboard/api-keys',
            icon: '🔑'
          },
          {
            order: 5,
            title: 'Invite Your Team',
            description: 'Add team members and assign roles to collaborate on content management.',
            link: '/dashboard/team',
            icon: '👥'
          },
          {
            order: 6,
            title: 'Configure Webhooks',
            description: 'Set up webhooks to trigger actions when content is published or updated.',
            link: '/dashboard/webhooks',
            icon: '🪝'
          }
        ],
        resources: [
          { title: 'Documentation', url: '/docs', description: 'Full documentation' },
          { title: 'API Reference', url: '/api-docs', description: 'REST & GraphQL APIs' },
          { title: 'Video Tutorials', url: '/tutorials', description: 'Step-by-step videos' },
          { title: 'Community', url: '/community', description: 'Join our forum' }
        ]
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}