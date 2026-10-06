import Bull, { Job, Queue } from 'bull';
import { Content } from '../models/Content';
import LocaleConfig from '../models/LocaleConfig';
import translationService from '../services/translationService';
import { decrypt } from '../services/cryptoService';

/**
 * Translation Worker — BullMQ-style async job processing via Bull
 *
 * This replaces the synchronous translation in the controller.
 * Jobs are queued instantly; the HTTP response returns immediately.
 * The worker processes translations in the background and updates the DB.
 */

export interface TranslationJobData {
    contentId: string;
    tenantId: string;
    userId: string;
    targetLocales?: string[]; // If empty, translate to ALL enabled locales
}

// Create the queue
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const translationQueue: Queue<TranslationJobData> = new Bull('translation', REDIS_URL, {
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000, // Start at 5s, then 25s, then 125s
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50,
    },
});

/**
 * Enqueue a translation job and return the job ID immediately.
 */
export async function enqueueTranslation(data: TranslationJobData): Promise<string> {
    const job = await translationQueue.add(data, {
        priority: 1,
    });
    return job.id!.toString();
}

/**
 * Get job status for polling.
 */
export async function getJobStatus(jobId: string) {
    const job = await translationQueue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress = job.progress();

    return {
        id: jobId,
        state,
        progress: typeof progress === 'number' ? progress : 0,
        data: job.data,
        result: job.returnvalue,
        failedReason: job.failedReason,
        createdAt: new Date(job.timestamp),
        completedAt: job.finishedOn ? new Date(job.finishedOn) : null,
    };
}

/**
 * Process translation jobs.
 */
translationQueue.process(async (job: Job<TranslationJobData>) => {
    const { contentId, tenantId, userId } = job.data;

    // 1. Fetch content
    const content = await Content.findOne({ _id: contentId, tenantId });
    if (!content) throw new Error(`Content ${contentId} not found`);

    // 2. Fetch locale config with encrypted API key
    const config = await LocaleConfig.findOne({ tenantId }).select('+translationApiKey');
    if (!config) throw new Error('Locale config not found for tenant');
    if (!config.autoTranslate) throw new Error('Auto-translation is disabled for this tenant');

    // 3. Decrypt API key
    let decryptedApiKey: string;
    try {
        decryptedApiKey = decrypt(config.translationApiKey!);
    } catch {
        throw new Error('Failed to decrypt translation API key. Please re-save the key in settings.');
    }

    // 4. Build a temporary decrypted config object for the service
    const workingConfig = {
        ...config.toObject(),
        translationApiKey: decryptedApiKey,
    };

    // 5. Determine target locales
    const enabledLocales = config.locales.filter(l => l.isEnabled && !l.isDefault);
    const targetLocales = job.data.targetLocales?.length
        ? enabledLocales.filter(l => job.data.targetLocales!.includes(l.code))
        : enabledLocales;

    if (targetLocales.length === 0) {
        return { message: 'No target locales to translate', results: [] };
    }

    // 6. Initialize localizedData
    if (!content.localizedData) content.localizedData = {};

    // 7. Translate each locale with progress updates
    const results = [];
    for (let i = 0; i < targetLocales.length; i++) {
        const locale = targetLocales[i];
        try {
            const translatedData = await translationService.translateObject(
                content.data as Record<string, any>,
                locale.code,
                workingConfig as any,
                config.defaultLocale
            );
            content.localizedData[locale.code] = translatedData;
            results.push({ locale: locale.code, status: 'done' });
        } catch (err: any) {
            results.push({ locale: locale.code, status: 'error', message: err.message });
        }

        // Update job progress
        await job.progress(Math.round(((i + 1) / targetLocales.length) * 100));
    }

    // 8. Save content
    content.markModified('localizedData');
    content.updatedBy = userId as any;
    await content.save();

    return { results };
});

// Log queue events
translationQueue.on('completed', (job, result) => {
    console.log(`[TranslationWorker] Job ${job.id} completed for content ${job.data.contentId}`);
});

translationQueue.on('failed', (job, err) => {
    console.error(`[TranslationWorker] Job ${job.id} failed: ${err.message}`);
});

translationQueue.on('stalled', (job) => {
    console.warn(`[TranslationWorker] Job ${job.id} stalled and will be retried`);
});

export default translationQueue;
