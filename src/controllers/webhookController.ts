import { Request, Response } from 'express';
import Webhook from '../models/Webhook';
import { AppError } from '../middleware/errorHandler';
import { webhookService } from '../services/webhookService';
import { WebhookLogService } from '../services/webhookLogService.js';

export const getWebhooks = async (req: Request, res: Response) => {
  const { projectId } = req.query;
  
  if (!projectId) {
    throw new AppError('Project ID is required', 400);
  }

  const webhooks = await Webhook.find({ projectId }).sort({ createdAt: -1 });
  
  res.json({
    success: true,
    data: webhooks
  });
};

export const getWebhook = async (req: Request, res: Response) => {
  const webhook = await Webhook.findById(req.params.id);
  
  if (!webhook) {
    throw new AppError('Webhook not found', 404);
  }
  
  res.json({
    success: true,
    data: webhook
  });
};

export const createWebhook = async (req: Request, res: Response) => {
  const { projectId, name, url, events, headers, secret } = req.body;
  
  const webhook = await Webhook.create({
    tenantId: req.user!.tenantId,
    projectId,
    name,
    url,
    events,
    headers,
    secret
  });
  
  res.status(201).json({
    success: true,
    data: webhook
  });
};

export const updateWebhook = async (req: Request, res: Response) => {
  const webhook = await Webhook.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );
  
  if (!webhook) {
    throw new AppError('Webhook not found', 404);
  }
  
  res.json({
    success: true,
    data: webhook
  });
};

export const deleteWebhook = async (req: Request, res: Response) => {
  await Webhook.findByIdAndDelete(req.params.id);
  
  res.json({
    success: true,
    message: 'Webhook deleted successfully'
  });
};

export const testWebhook = async (req: Request, res: Response) => {
  const { id } = req.params;
  const webhook = await Webhook.findById(id);
  
  if (!webhook) {
    throw new AppError('Webhook not found', 404);
  }

  // Fire a test event
  await webhookService.triggerWebhook(
    webhook.projectId.toString(),
    'ping.test',
    { message: 'This is a test webhook event', user: req.user!.email }
  );

  res.json({
    success: true,
    message: 'Test webhook triggered'
  });
};

export const getWebhookLogs = async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { webhookId, event, status, startDate, endDate, limit = 20, offset = 0 } = req.query;

  const result = await WebhookLogService.getLogs(tenantId, {
    webhookId: webhookId as string,
    event: event as string,
    status: status as string,
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
    limit: Number(limit),
    offset: Number(offset)
  });

  res.json({
    success: true,
    data: result.logs,
    pagination: {
      total: result.total,
      limit: Number(limit),
      offset: Number(offset)
    }
  });
};

export const getWebhookLog = async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;

  const log = await WebhookLogService.getLogById(id, tenantId);

  if (!log) {
    throw new AppError('Webhook log not found', 404);
  }

  res.json({
    success: true,
    data: log
  });
};

export const retryWebhookLog = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await WebhookLogService.retryWebhook(id);
    res.json({
      success: result.success,
      message: result.success ? 'Retry successful' : 'Retry failed',
      statusCode: result.statusCode
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getWebhookStats = async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { webhookId, startDate, endDate } = req.query;

  const stats = await WebhookLogService.getStatistics(tenantId, {
    webhookId: webhookId as string,
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined
  });

  res.json({
    success: true,
    data: stats
  });
};
