import { safePost } from '../utils/safeFetch.js';
import crypto from 'crypto';
import Webhook, { IWebhook } from '../models/Webhook.js';
import { WebhookLogService } from './webhookLogService.js';
import { webhookDeliveryTotal } from '../utils/metrics.js';

interface WebhookPayload {
  event: string;
  data: any;
  timestamp: string;
}

export class WebhookService {
  /**
   * Trigger webhooks for a specific event
   */
  async triggerWebhook(projectId: string, event: string, data: any): Promise<void> {
    try {
      const eventParts = event.split('.');
      const wildcardEvent = eventParts.length > 1 ? `${eventParts[0]}.*` : '*';

      const webhooks = await Webhook.find({
        projectId,
        isEnabled: true,
        events: { $in: [event, wildcardEvent, '*'] }
      });

      if (webhooks.length === 0) return;

      const payload: WebhookPayload = {
        event,
        data,
        timestamp: new Date().toISOString()
      };

      webhooks.forEach(webhook => this.sendToWebhook(webhook, payload));
      
    } catch (error) {
      console.error('Error triggering webhooks:', error);
    }
  }

  /**
   * Send payload to a single webhook
   */
  private async sendToWebhook(webhook: IWebhook, payload: WebhookPayload): Promise<void> {
    let logId: string | undefined;
    const startTime = Date.now();
    try {
      // Create initial log
      const log = await WebhookLogService.createLog({
        webhookId: webhook._id.toString(),
        tenantId: webhook.tenantId.toString(),
        event: payload.event,
        payload
      });
      logId = log._id.toString();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Headless-CMS-Webhook/1.0',
        'X-Webhook-Event': payload.event,
        ...(webhook.headers ? Object.fromEntries(webhook.headers as any) : {})
      };

      let finalPayload: any = payload;

      // CI/CD payload mappings
      if (webhook.integrationType === 'github') {
         headers['Accept'] = 'application/vnd.github.v3+json';
         finalPayload = {
             event_type: "cms_" + payload.event.replace(/\./g, '_'),
             client_payload: payload
         };
      } else if (webhook.integrationType === 'gitlab') {
         finalPayload = {
             token: webhook.secret, // GitLab requires token in payload usually or header
             ref: "main",
             variables: {
                 CMS_EVENT: payload.event,
                 CMS_DATA: JSON.stringify(payload.data)
             }
         };
      }

      const timestamp = Date.now().toString();
      headers['X-CMS-Timestamp'] = timestamp;

      if (webhook.secret) {
        // Sign payload combining timestamp and payload for replay protection
        const signature = crypto
          .createHmac('sha256', webhook.secret)
          .update(`${timestamp}.${JSON.stringify(finalPayload)}`)
          .digest('hex');
        headers['X-CMS-Signature'] = `sha256=${signature}`;
      }

      const response = await safePost(webhook.url, finalPayload, {
        headers,
        timeout: 5000
      });

      const duration = Date.now() - startTime;

      // Update log
      if (logId) {
        await WebhookLogService.updateLog(logId, {
          response: {
             statusCode: response.status,
             body: typeof response.data === 'object' ? JSON.stringify(response.data).substring(0, 500) : String(response.data).substring(0, 500),
             duration
          },
          status: 'success',
          attempts: 1
        });
      }

      // Update success stats
      await Webhook.findByIdAndUpdate(webhook._id, {
        lastTriggeredAt: new Date(),
        $set: { failureCount: 0 }
      });
      webhookDeliveryTotal.labels(webhook.tenantId.toString(), 'success').inc();

    } catch (error: any) {
      console.error(`Webhook delivery failed for ${webhook.name}:`, error.message);
      const duration = Date.now() - startTime;

      if (logId) {
        await WebhookLogService.updateLog(logId, {
          response: {
             statusCode: error.response?.status || 0,
             body: error.message,
             duration
          },
          status: 'failed',
          error: error.message,
          attempts: 1
        });
      }
      
      await Webhook.findByIdAndUpdate(webhook._id, {
        $inc: { failureCount: 1 }
      });
      webhookDeliveryTotal.labels(webhook.tenantId.toString(), 'failed').inc();
      
      if (webhook.failureCount >= 10) {
        await Webhook.findByIdAndUpdate(webhook._id, {
          isEnabled: false
        });
        console.warn(`Webhook ${webhook.name} disabled due to excessive failures.`);
      }
    }
  }
}

export const webhookService = new WebhookService();
