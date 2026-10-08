import cron from 'node-cron';
import { withJobLock } from '../utils/jobLock.js';
import { billByokFees } from '../services/billingService.js';
import { BackupService } from '../services/backupService.js';

/**
 * Daily housekeeping: bill bring-your-own-key AI fees and prune old backups.
 */
class BillingWorker {
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    console.log('✅ Billing & housekeeping worker started (daily 03:15)');
    cron.schedule('15 3 * * *', () => {
      void withJobLock('daily-housekeeping', 30 * 60_000, async () => {
        const billed = await billByokFees().catch((e) => { console.error('[billing] BYOK fees failed', e); return 0; });
        if (billed) console.log(`[billing] BYOK fee added for ${billed} workspace(s)`);
        const days = Number(process.env.BACKUP_RETENTION_DAYS || 30);
        const removed = await BackupService.cleanupOldBackups(days).catch(() => 0);
        if (removed) console.log(`[backups] removed ${removed} backup(s) older than ${days} days`);
      });
    });
  }
}

export const billingWorker = new BillingWorker();
