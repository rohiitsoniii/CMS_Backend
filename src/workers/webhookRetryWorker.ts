import cron from 'node-cron';
import { withJobLock } from '../utils/jobLock.js';
import { WebhookLog } from '../models/WebhookLog.js';
import Webhook from '../models/Webhook.js';
import { WebhookLogService } from '../services/webhookLogService.js';
import { webhookDeliveryTotal } from '../utils/metrics.js';

/** Max total attempts (initial delivery + retries) before dead-lettering. */
export const MAX_RETRY_ATTEMPTS = 6;

/** Max logs claimed + processed per tick, oldest first. */
export const RETRY_BATCH_SIZE = 50;

export const DEAD_LETTER_ERROR = 'Max retry attempts exhausted (dead-letter)';

/** Matches terminal (do-not-retry) markers set by skip/dead-letter paths. */
const TERMINAL_ERROR_PATTERN = /\(dead-letter\)/;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Backoff delay for the *post-attempt* attempts count:
 * attempt 1 -> +5m, 2 -> +15m, 3 -> +1h, 4 -> +6h, 5 -> +24h.
 * Returns null when no further retry should be scheduled.
 */
export function getRetryDelayMs(attemptsAfterIncrement: number): number | null {
  switch (attemptsAfterIncrement) {
    case 1:
      return 5 * MINUTE_MS;
    case 2:
      return 15 * MINUTE_MS;
    case 3:
      return 1 * HOUR_MS;
    case 4:
      return 6 * HOUR_MS;
    case 5:
      return 24 * HOUR_MS;
    default:
      return null;
  }
}

export function computeNextRetryAt(attemptsAfterIncrement: number, from: Date = new Date()): Date | null {
  const delay = getRetryDelayMs(attemptsAfterIncrement);
  if (delay === null) return null;
  return new Date(from.getTime() + delay);
}

function safeMetricInc(tenantId: string, status: 'success' | 'failed'): void {
  try {
    webhookDeliveryTotal.labels?.(tenantId, status)?.inc();
  } catch (err) {
    console.error(`[webhook-retry] metric increment failed: ${(err as Error).message}`);
  }
}

class WebhookRetryWorker {
  private task: ReturnType<typeof cron.schedule> | null = null;
  private initialTimeout: ReturnType<typeof setTimeout> | null = null;
  private tickRunning = false;
  private started = false;

  start(): void {
    if (process.env.WEBHOOK_RETRY_ENABLED === 'false') {
      console.log('[webhook-retry] disabled via WEBHOOK_RETRY_ENABLED=false');
      return;
    }
    if (this.started) return;
    this.started = true;

    console.log('[webhook-retry] worker started (every minute)');

    this.task = cron.schedule('* * * * *', () => {
      void withJobLock('webhook-retry', 5 * 60_000, () => this.processDueRetries());
    });

    // Initial delayed sweep so a restart picks up overdue logs quickly
    // without blocking boot. unref so tests/CLI don't hang on the timer.
    this.initialTimeout = setTimeout(() => {
      void withJobLock('webhook-retry', 5 * 60_000, () => this.processDueRetries());
    }, 10_000);
    const t = this.initialTimeout as unknown as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    this.started = false;
    this.tickRunning = false;
    console.log('[webhook-retry] worker stopped');
  }

  /** Public entry for cron ticks and tests. Never throws. */
  async processDueRetries(): Promise<void> {
    if (this.tickRunning) {
      console.log('[webhook-retry] tick already running, skipping overlap');
      return;
    }
    this.tickRunning = true;
    try {
      const now = new Date();
      for (let i = 0; i < RETRY_BATCH_SIZE; i++) {
        let claimed: { _id: unknown } | null = null;
        try {
          claimed = await WebhookLog.findOneAndUpdate(
            {
              status: { $in: ['failed', 'retrying'] },
              attempts: { $lt: MAX_RETRY_ATTEMPTS },
              // Terminal dead-letter/skip markers must never be re-claimed.
              error: { $not: TERMINAL_ERROR_PATTERN },
              $or: [{ nextRetryAt: { $lte: now } }, { nextRetryAt: { $exists: false } }, { nextRetryAt: null }],
            },
            { $set: { status: 'retrying' } },
            { new: true, sort: { createdAt: 1 } },
          ).exec();
        } catch (err) {
          console.error(`[webhook-retry] claim failed: ${(err as Error).message}`);
          break;
        }
        if (!claimed) break;
        await this.processClaimedLog(String((claimed as { _id: { toString(): string } })._id.toString()));
      }
    } catch (err) {
      console.error(`[webhook-retry] tick failed: ${(err as Error).message}`);
    } finally {
      this.tickRunning = false;
    }
  }

  private async processClaimedLog(logId: string): Promise<void> {
    try {
      const log = await WebhookLog.findById(logId).exec();
      if (!log) {
        console.log(`[webhook-retry] log ${logId} not found, skipping`);
        return;
      }

      // Guard: missing references — dead-letter, no retry.
      if (!log.webhookId || log.payload === null || log.payload === undefined) {
        await WebhookLog.findByIdAndUpdate(logId, {
          $set: { status: 'failed', error: 'Webhook payload or reference missing (dead-letter)' },
          $unset: { nextRetryAt: '' },
        }).exec();
        console.log(`[webhook-retry] log ${logId} missing webhook/payload, marked failed`);
        return;
      }

      const webhook = await Webhook.findById(log.webhookId).exec();
      if (!webhook) {
        await WebhookLog.findByIdAndUpdate(logId, {
          $set: { status: 'failed', error: 'Webhook not found (dead-letter)' },
          $unset: { nextRetryAt: '' },
        }).exec();
        console.log(`[webhook-retry] log ${logId} webhook missing, marked failed`);
        return;
      }
      if (!webhook.isEnabled) {
        await WebhookLog.findByIdAndUpdate(logId, {
          $set: { status: 'failed', error: 'Webhook inactive, retry skipped (dead-letter)' },
          $unset: { nextRetryAt: '' },
        }).exec();
        console.log(`[webhook-retry] log ${logId} webhook inactive, marked failed`);
        return;
      }

      // Each attempt delegates to the existing single-attempt delivery.
      let result: { success: boolean } | null = null;
      try {
        const r = (await WebhookLogService.retryWebhook(logId)) as { success: boolean };
        result = r;
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        if (msg.includes('Webhook log not found') || msg.includes('Webhook not found')) {
          await WebhookLog.findByIdAndUpdate(logId, {
            $set: { status: 'failed', error: `${msg} (dead-letter)` },
            $unset: { nextRetryAt: '' },
          }).exec();
          console.log(`[webhook-retry] log ${logId} dead-lettered during retry: ${msg}`);
          return;
        }
        // Network/HTTP failure: retryWebhook already persisted attempts+1
        // as status 'failed' before rethrowing — fall through to backoff.
        console.log(`[webhook-retry] log ${logId} attempt threw: ${msg}`);
      }

      const fresh = await WebhookLog.findById(logId).exec();
      if (!fresh) {
        console.log(`[webhook-retry] log ${logId} vanished after attempt, skipping`);
        return;
      }
      const tenantId = fresh.tenantId?.toString() ?? 'unknown';

      if (result?.success === true || fresh.status === 'success') {
        await WebhookLog.findByIdAndUpdate(logId, {
          $set: { status: 'success' },
          $unset: { nextRetryAt: '' },
        }).exec();
        safeMetricInc(tenantId, 'success');
        console.log(`[webhook-retry] log ${logId} retry succeeded (attempts=${fresh.attempts})`);
        return;
      }

      // Failure path: schedule backoff or dead-letter.
      safeMetricInc(tenantId, 'failed');
      if (fresh.attempts >= MAX_RETRY_ATTEMPTS) {
        await WebhookLog.findByIdAndUpdate(logId, {
          $set: { status: 'failed', error: DEAD_LETTER_ERROR },
          $unset: { nextRetryAt: '' },
        }).exec();
        console.log(`[webhook-retry] log ${logId} dead-lettered after ${fresh.attempts} attempts`);
        return;
      }

      const nextRetryAt = computeNextRetryAt(fresh.attempts);
      await WebhookLog.findByIdAndUpdate(logId, {
        $set: { status: 'retrying', nextRetryAt: nextRetryAt ?? undefined },
      }).exec();
      console.log(
        `[webhook-retry] log ${logId} retry failed (attempts=${fresh.attempts}), next retry at ${nextRetryAt?.toISOString()}`,
      );
    } catch (err) {
      console.error(`[webhook-retry] failed to process log ${logId}: ${(err as Error).message}`);
    }
  }
}

export const webhookRetryWorker = new WebhookRetryWorker();
