/**
 * Content Scheduling Service
 * 
 * Handles scheduled publishing, unpublishing, and recurring content
 */

import cron, { ScheduledTask as CronScheduledTask } from 'node-cron';
import { Content } from '../models/Content';
import collaborationService from './collaborationService';
import { contentPublishedTotal } from '../utils/metrics.js';

interface ScheduledTask {
  id: string;
  contentId: string;
  action: 'publish' | 'unpublish';
  scheduledAt: Date;
  cronTask?: CronScheduledTask;
  recurring?: {
    pattern: string; // cron pattern
    endDate?: Date;
  };
}

class SchedulingService {
  private tasks: Map<string, ScheduledTask> = new Map();
  private isInitialized = false;

  /**
   * Initialize scheduling service
   */
  async initialize() {
    if (this.isInitialized) return;

    console.log('🕐 Initializing scheduling service...');

    // Load existing scheduled content
    await this.loadScheduledContent();

    // Check for scheduled tasks every minute
    cron.schedule('* * * * *', () => {
      this.processScheduledTasks();
    });

    this.isInitialized = true;
    console.log('✅ Scheduling service initialized');
  }

  /**
   * Load scheduled content from database
   */
  private async loadScheduledContent() {
    try {
      // Find content with scheduled publish dates
      const scheduledContent = await Content.find({
        $or: [
          { 'scheduling.publishAt': { $exists: true, $ne: null } },
          { 'scheduling.unpublishAt': { $exists: true, $ne: null } },
        ],
      });

      for (const content of scheduledContent) {
        if (content.scheduling?.publishAt) {
          this.schedulePublish(
            content._id.toString(),
            new Date(content.scheduling.publishAt),
            content.scheduling.recurring
          );
        }

        if (content.scheduling?.unpublishAt) {
          this.scheduleUnpublish(
            content._id.toString(),
            new Date(content.scheduling.unpublishAt)
          );
        }
      }

      console.log(`📅 Loaded ${scheduledContent.length} scheduled content items`);
    } catch (error) {
      console.error('Error loading scheduled content:', error);
    }
  }

  /**
   * Schedule content to be published
   */
  schedulePublish(
    contentId: string,
    publishAt: Date,
    recurring?: { pattern: string; endDate?: Date }
  ): string {
    const taskId = `publish_${contentId}_${Date.now()}`;

    const task: ScheduledTask = {
      id: taskId,
      contentId,
      action: 'publish',
      scheduledAt: publishAt,
      recurring,
    };

    // If recurring, set up cron job
    if (recurring?.pattern) {
      try {
        task.cronTask = cron.schedule(recurring.pattern, async () => {
          await this.executePublish(contentId);

          // Check if recurring should end
          if (recurring.endDate && new Date() > recurring.endDate) {
            task.cronTask?.stop();
            this.tasks.delete(taskId);
          }
        });
      } catch (error) {
        console.error('Invalid cron pattern:', recurring.pattern);
      }
    }

    this.tasks.set(taskId, task);
    console.log(`📅 Scheduled publish for ${contentId} at ${publishAt}`);

    return taskId;
  }

  /**
   * Schedule content to be unpublished
   */
  scheduleUnpublish(contentId: string, unpublishAt: Date): string {
    const taskId = `unpublish_${contentId}_${Date.now()}`;

    const task: ScheduledTask = {
      id: taskId,
      contentId,
      action: 'unpublish',
      scheduledAt: unpublishAt,
    };

    this.tasks.set(taskId, task);
    console.log(`📅 Scheduled unpublish for ${contentId} at ${unpublishAt}`);

    return taskId;
  }

  /**
   * Cancel scheduled task
   */
  cancelSchedule(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.cronTask) {
      task.cronTask.stop();
    }

    this.tasks.delete(taskId);
    console.log(`❌ Cancelled scheduled task: ${taskId}`);

    return true;
  }

  /**
   * Process scheduled tasks
   */
  private async processScheduledTasks() {
    const now = new Date();

    for (const [taskId, task] of Array.from(this.tasks.entries())) {
      // Skip recurring tasks (handled by cron)
      if (task.recurring) continue;

      // Check if task should be executed
      if (task.scheduledAt <= now) {
        try {
          if (task.action === 'publish') {
            await this.executePublish(task.contentId);
          } else if (task.action === 'unpublish') {
            await this.executeUnpublish(task.contentId);
          }

          // Remove completed task
          this.tasks.delete(taskId);
        } catch (error) {
          console.error(`Error executing scheduled task ${taskId}:`, error);
        }
      }
    }
  }

  /**
   * Execute publish action
   */
  private async executePublish(contentId: string) {
    try {
      const content = await Content.findById(contentId);
      if (!content) {
        console.error(`Content not found: ${contentId}`);
        return;
      }

      // Update status to published
      content.status = 'published';
      if (!content.meta) {
        content.meta = {};
      }
      content.meta.publishedAt = new Date();
      content.publishedAt = new Date();
      await content.save();
      contentPublishedTotal.labels(content.tenantId.toString(), content.type).inc();

      console.log(`✅ Auto-published content: ${content.name}`);

      // Broadcast notification
      if (collaborationService.getIO()) {
        collaborationService.broadcastContentPublished(contentId, content);
        collaborationService.broadcastNotification({
          type: 'content.published',
          title: 'Content Published',
          message: `"${content.name}" has been automatically published`,
          data: { contentId },
        });
      }
    } catch (error) {
      console.error(`Error publishing content ${contentId}:`, error);
    }
  }

  /**
   * Execute unpublish action
   */
  private async executeUnpublish(contentId: string) {
    try {
      const content = await Content.findById(contentId);
      if (!content) {
        console.error(`Content not found: ${contentId}`);
        return;
      }

      // Update status to draft
      content.status = 'draft';
      await content.save();

      console.log(`✅ Auto-unpublished content: ${content.name}`);

      // Broadcast notification
      if (collaborationService.getIO()) {
        collaborationService.broadcastNotification({
          type: 'content.unpublished',
          title: 'Content Unpublished',
          message: `"${content.name}" has been automatically unpublished`,
          data: { contentId },
        });
      }
    } catch (error) {
      console.error(`Error unpublishing content ${contentId}:`, error);
    }
  }

  /**
   * Get all scheduled tasks
   */
  getScheduledTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values()).map((task) => ({
      id: task.id,
      contentId: task.contentId,
      action: task.action,
      scheduledAt: task.scheduledAt,
      recurring: task.recurring,
    }));
  }

  /**
   * Get scheduled tasks for specific content
   */
  getContentSchedule(contentId: string): ScheduledTask[] {
    return this.getScheduledTasks().filter((task) => task.contentId === contentId);
  }

  /**
   * Update content scheduling in database
   */
  async updateContentScheduling(
    contentId: string,
    scheduling: {
      publishAt?: Date;
      unpublishAt?: Date;
      recurring?: { pattern: string; endDate?: Date };
    }
  ) {
    try {
      const content = await Content.findById(contentId);
      if (!content) throw new Error('Content not found');

      // Update scheduling in content
      content.scheduling = {
        publishAt: scheduling.publishAt,
        unpublishAt: scheduling.unpublishAt,
        recurring: scheduling.recurring,
      };

      await content.save();

      // Cancel existing tasks for this content
      const existingTasks = this.getContentSchedule(contentId);
      existingTasks.forEach((task) => this.cancelSchedule(task.id));

      // Schedule new tasks
      if (scheduling.publishAt) {
        this.schedulePublish(contentId, scheduling.publishAt, scheduling.recurring);
      }

      if (scheduling.unpublishAt) {
        this.scheduleUnpublish(contentId, scheduling.unpublishAt);
      }

      return content;
    } catch (error) {
      console.error('Error updating content scheduling:', error);
      throw error;
    }
  }

  /**
   * Clear all scheduling for content
   */
  async clearContentScheduling(contentId: string) {
    try {
      const content = await Content.findById(contentId);
      if (!content) throw new Error('Content not found');

      // Clear scheduling in database
      content.scheduling = undefined;
      await content.save();

      // Cancel all tasks
      const tasks = this.getContentSchedule(contentId);
      tasks.forEach((task) => this.cancelSchedule(task.id));

      return content;
    } catch (error) {
      console.error('Error clearing content scheduling:', error);
      throw error;
    }
  }

  /**
   * Get calendar view of scheduled content
   */
  async getCalendarView(startDate: Date, endDate: Date) {
    try {
      const scheduledContent = await Content.find({
        $or: [
          {
            'scheduling.publishAt': {
              $gte: startDate,
              $lte: endDate,
            },
          },
          {
            'scheduling.unpublishAt': {
              $gte: startDate,
              $lte: endDate,
            },
          },
        ],
      })
        .select('name type status scheduling createdBy')
        .populate('createdBy', 'name email');

      return scheduledContent.map((content) => ({
        id: content._id,
        name: content.name,
        type: content.type,
        status: content.status,
        publishAt: content.scheduling?.publishAt,
        unpublishAt: content.scheduling?.unpublishAt,
        recurring: content.scheduling?.recurring,
        author: content.createdBy,
      }));
    } catch (error) {
      console.error('Error getting calendar view:', error);
      throw error;
    }
  }
}

export default new SchedulingService();
