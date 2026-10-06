import { APIKey } from '../models/APIKey.js';
import { User } from '../models/User.js';
import { logger } from '../utils/logger.js';

export const checkExpiringApiKeys = async () => {
  try {
    logger.info('Starting API Key expiration check job');
    const warningThreshold = new Date();
    warningThreshold.setDate(warningThreshold.getDate() + 7); // 7 days from now

    // Find keys expiring in the next 7 days that are still active
    const expiringKeys = await APIKey.find({
      isActive: true,
      expiresAt: { $lt: warningThreshold, $gt: new Date() }
    }).populate('tenantId');

    for (const key of expiringKeys) {
      // Logic to get tenant owner and send email
      const owner = await User.findOne({ tenantId: key.tenantId, role: 'owner' });
      if (owner) {
        // Mock email alert
        logger.info({ 
          tenantId: key.tenantId, 
          email: owner.email, 
          keyName: key.name 
        }, `[SEND_EMAIL] Action Required: Your API Key "${key.name}" expires in less than 7 days. Please rotate it to prevent service disruption.`);
      }
    }
    
    logger.info(`Completed API Key expiration check. Found ${expiringKeys.length} expiring keys.`);
  } catch (error) {
    logger.error({ err: error }, 'Failed to run apiKeyRotationReminder job');
  }
};

// In a real staging/prod setup, you would hook this to a Cron scheduler:
// setInterval(checkExpiringApiKeys, 24 * 60 * 60 * 1000); // Daily
