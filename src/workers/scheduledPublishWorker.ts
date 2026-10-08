import cron from 'node-cron';
import { Content } from '../models/index.js';
import { webhookService } from '../services/webhookService.js';
import { contentEvents } from '../services/contentEvents.js';
import { withJobLock } from '../utils/jobLock.js';

/**
 * Worker that runs every minute to publish or unpublish scheduled content.
 */
class ScheduledPublishWorker {
    private isRunning = false;

    start() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('✅ Scheduled Publish Worker started');

        // Run every minute at the 0th second
        cron.schedule('* * * * *', async () => {
             await withJobLock('scheduled-publish', 5 * 60_000, () => this.processScheduledContent());
        });
    }

    private async processScheduledContent() {
        try {
            const now = new Date();

            // Find all content scheduled to be published
            const itemsToPublish = await Content.find({
                status: 'scheduled',
                publishedAt: { $lte: now }
            });

            if (itemsToPublish.length > 0) {
                 for (const item of itemsToPublish) {
                    item.status = 'published';
                    await item.save();
                    
                    // Trigger webhooks for publishing
                    webhookService.triggerWebhook(
                        item.projectId.toString(),
                        'content.published',
                        {
                             contentId: item._id,
                             type: item.contentTypeApiId || item.type,
                             slug: item.slug
                        }
                    ).catch((err: any) => console.error("Webhook failed to trigger", err));
                    
                    // Chatbot knowledge + search engine ping (webhook already sent above)
                    contentEvents.published(item, { webhook: false });

                    console.log(`[Worker] Auto-Published content: ${item.slug}`);
                 }
            }

            // Find all content scheduled to be unpublished
            const itemsToUnpublish = await Content.find({
                status: 'published',
                unpublishedAt: { $lte: now }
            });

             if (itemsToUnpublish.length > 0) {
                 for (const item of itemsToUnpublish) {
                    item.status = 'archived'; // or 'draft'
                    await item.save();
                    
                    // Trigger webhooks for unpublishing
                    webhookService.triggerWebhook(
                        item.projectId.toString(),
                        'content.unpublished',
                        {
                             contentId: item._id,
                             type: item.contentTypeApiId || item.type,
                             slug: item.slug
                        }
                    ).catch((err: any) => console.error("Webhook failed to trigger", err));

                    contentEvents.unpublished(item, { webhook: false });

                    console.log(`[Worker] Auto-Unpublished content: ${item.slug}`);
                 }
            }

        } catch (error) {
            console.error('[Worker] Error processing scheduled content:', error);
        }
    }
}

export const scheduledPublishWorker = new ScheduledPublishWorker();
