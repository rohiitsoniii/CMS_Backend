import { WebhookLog } from '../models/WebhookLog.js';
import { Webhook } from '../models/Webhook.js';
import mongoose from 'mongoose';

export class WebhookLogService {
  static async createLog(data: {
    webhookId: string;
    tenantId: string;
    event: string;
    payload: any;
    triggeredBy?: string;
  }): Promise<any> {
    return WebhookLog.create({
      webhookId: new mongoose.Types.ObjectId(data.webhookId),
      tenantId: new mongoose.Types.ObjectId(data.tenantId),
      event: data.event,
      payload: data.payload,
      triggeredBy: data.triggeredBy ? new mongoose.Types.ObjectId(data.triggeredBy) : undefined,
      status: 'pending'
    });
  }

  static async updateLog(
    logId: string,
    data: {
      response?: { statusCode: number; body: string; duration: number };
      status?: 'success' | 'failed' | 'pending' | 'retrying';
      error?: string;
      attempts?: number;
      nextRetryAt?: Date;
    }
  ): Promise<any> {
    return WebhookLog.findByIdAndUpdate(logId, { $set: data }, { new: true });
  }

  static async getLogs(
    tenantId: string,
    options: {
      webhookId?: string;
      event?: string;
      status?: string;
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<{ logs: any[]; total: number }> {
    const query: any = { tenantId: new mongoose.Types.ObjectId(tenantId) };

    if (options.webhookId) {
      query.webhookId = new mongoose.Types.ObjectId(options.webhookId);
    }
    if (options.event) {
      query.event = options.event;
    }
    if (options.status) {
      query.status = options.status;
    }
    if (options.startDate || options.endDate) {
      query.createdAt = {};
      if (options.startDate) query.createdAt.$gte = options.startDate;
      if (options.endDate) query.createdAt.$lte = options.endDate;
    }

    const [logs, total] = await Promise.all([
      WebhookLog.find(query)
        .populate('webhookId', 'name url events')
        .populate('triggeredBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(options.offset || 0)
        .limit(options.limit || 20),
      WebhookLog.countDocuments(query)
    ]);

    return { logs, total };
  }

  static async getLogById(logId: string, tenantId: string): Promise<any> {
    return WebhookLog.findOne({
      _id: new mongoose.Types.ObjectId(logId),
      tenantId: new mongoose.Types.ObjectId(tenantId)
    })
    .populate('webhookId')
    .populate('triggeredBy', 'name email');
  }

  static async retryWebhook(logId: string): Promise<any> {
    const log = await WebhookLog.findById(logId);
    if (!log) throw new Error('Webhook log not found');

    const webhook = await Webhook.findById(log.webhookId);
    if (!webhook) throw new Error('Webhook not found');

    const startTime = Date.now();
    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': log.event,
          'X-Webhook-ID': webhook._id.toString()
        },
        body: JSON.stringify(log.payload)
      });

      const duration = Date.now() - startTime;
      const responseBody = await response.text();

      await WebhookLog.findByIdAndUpdate(logId, {
        $set: {
          response: {
            statusCode: response.status,
            body: responseBody.substring(0, 1000),
            duration
          },
          status: response.ok ? 'success' : 'failed',
          attempts: log.attempts + 1,
          error: response.ok ? undefined : `HTTP ${response.status}`
        }
      });

      return { success: response.ok, statusCode: response.status };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      await WebhookLog.findByIdAndUpdate(logId, {
        $set: {
          response: { statusCode: 0, body: error.message, duration },
          status: 'failed',
          attempts: log.attempts + 1,
          error: error.message
        }
      });
      throw error;
    }
  }

  static async getStatistics(
    tenantId: string,
    options: { startDate?: Date; endDate?: Date; webhookId?: string }
  ): Promise<any> {
    const match: any = { tenantId: new mongoose.Types.ObjectId(tenantId) };
    
    if (options.startDate || options.endDate) {
      match.createdAt = {};
      if (options.startDate) match.createdAt.$gte = options.startDate;
      if (options.endDate) match.createdAt.$lte = options.endDate;
    }
    if (options.webhookId) {
      match.webhookId = new mongoose.Types.ObjectId(options.webhookId);
    }

    const stats = await WebhookLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgDuration: { $avg: '$response.duration' },
          totalDuration: { $sum: '$response.duration' }
        }
      }
    ]);

    const eventStats = await WebhookLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$event',
          count: { $sum: 1 },
          success: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      },
      { $sort: { count: -1 } }
    ]);

    return {
      byStatus: stats.reduce((acc: any, s: any) => {
        acc[s._id] = s;
        return acc;
      }, {}),
      byEvent: eventStats
    };
  }
}