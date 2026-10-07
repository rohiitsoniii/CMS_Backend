import cron from 'node-cron';
import { EmailCampaign } from '../models/EmailCampaign.js';
import { prepareCampaign, sendCampaignBatch } from '../services/emailMarketingService.js';

/**
 * Starts due scheduled campaigns and drips pending recipients of sending
 * campaigns in small batches (EMAIL_SEND_BATCH per campaign per tick), so
 * sends survive restarts and stay under provider rate limits.
 */
class EmailCampaignWorker {
    private started = false;
    private busy = false;

    start() {
        if (this.started) return;
        this.started = true;
        console.log('✅ Email Campaign Worker started');
        // Every 20 seconds
        cron.schedule('*/20 * * * * *', () => {
            this.tick().catch((err) => console.error('[EmailCampaignWorker] tick failed:', err));
        });
    }

    async tick() {
        if (this.busy) return;
        this.busy = true;
        try {
            const due = await EmailCampaign.find({ status: 'scheduled', scheduledFor: { $lte: new Date() } }).limit(20);
            for (const campaign of due) {
                try {
                    const total = await prepareCampaign(campaign);
                    if (total === 0) {
                        campaign.status = 'failed';
                        campaign.lastError = 'No subscribed contacts in this audience at send time';
                        await campaign.save();
                    }
                } catch (err: any) {
                    campaign.status = 'failed';
                    campaign.lastError = String(err.message || err).slice(0, 500);
                    await campaign.save();
                }
            }

            const sending = await EmailCampaign.find({ status: 'sending' }).select('_id').limit(50);
            for (const c of sending) {
                await sendCampaignBatch(c._id);
            }
        } finally {
            this.busy = false;
        }
    }
}

export const emailCampaignWorker = new EmailCampaignWorker();
