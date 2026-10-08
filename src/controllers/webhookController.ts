import { Request, Response } from 'express';
import Webhook from '../models/Webhook';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { webhookService } from '../services/webhookService';
import { WebhookLogService } from '../services/webhookLogService.js';
import { Project } from '../models/index.js';
import { assertPublicUrl } from '../utils/safeFetch.js';

const tenantOf = (req: Request) => req.user!.tenantId.toString();

/** Throws unless the URL is a public http(s) endpoint (no localhost/private IPs). */
function assertWebhookUrl(url: unknown) {
  if (url === undefined) return;
  try {
    assertPublicUrl(String(url));
  } catch (err: any) {
    throw new AppError(`Webhook URL not allowed: ${err.message}`, 400, 'WEBHOOK_URL_BLOCKED');
  }
}

async function assertOwnProject(req: Request, projectId: unknown) {
  const project = await Project.exists({ _id: projectId, tenantId: tenantOf(req) });
  if (!project) throw new AppError('Project not found', 404);
}

export const getWebhooks = asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.query;
  
  if (!projectId) {
    throw new AppError('Project ID is required', 400);
  }

  const webhooks = await Webhook.find({ projectId, tenantId: tenantOf(req) }).sort({ createdAt: -1 });
  
  res.json({
    success: true,
    data: webhooks
  });
});

export const getWebhook = asyncHandler(async (req: Request, res: Response) => {
  const webhook = await Webhook.findOne({ _id: req.params.id, tenantId: tenantOf(req) });
  
  if (!webhook) {
    throw new AppError('Webhook not found', 404);
  }
  
  res.json({
    success: true,
    data: webhook
  });
});

export const createWebhook = asyncHandler(async (req: Request, res: Response) => {
  const { projectId, name, url, events, headers, secret } = req.body;
  assertWebhookUrl(url);
  await assertOwnProject(req, projectId);
  
  const webhook = await Webhook.create({
    tenantId: tenantOf(req),
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
});

const UPDATABLE = ['name', 'url', 'events', 'headers', 'secret', 'isEnabled', 'integrationType'] as const;

export const updateWebhook = asyncHandler(async (req: Request, res: Response) => {
  assertWebhookUrl(req.body.url);
  const update: Record<string, unknown> = {};
  for (const k of UPDATABLE) if (req.body[k] !== undefined) update[k] = req.body[k];
  const webhook = await Webhook.findOneAndUpdate(
    { _id: req.params.id, tenantId: tenantOf(req) },
    { $set: update },
    { new: true, runValidators: true }
  );
  
  if (!webhook) {
    throw new AppError('Webhook not found', 404);
  }
  
  res.json({
    success: true,
    data: webhook
  });
});

export const deleteWebhook = asyncHandler(async (req: Request, res: Response) => {
  const deleted = await Webhook.findOneAndDelete({ _id: req.params.id, tenantId: tenantOf(req) });
  if (!deleted) throw new AppError('Webhook not found', 404);
  
  res.json({
    success: true,
    message: 'Webhook deleted successfully'
  });
});

export const testWebhook = asyncHandler(async (req: Request, res: Response) => {
  const webhook = await Webhook.findOne({ _id: req.params.id, tenantId: tenantOf(req) });
  
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
});

export const getWebhookLogs = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId.toString();
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
});

export const getWebhookLog = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId.toString();
  const { id } = req.params;

  const log = await WebhookLogService.getLogById(id, tenantId);

  if (!log) {
    throw new AppError('Webhook log not found', 404);
  }

  res.json({
    success: true,
    data: log
  });
});

export const retryWebhookLog = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await WebhookLogService.retryWebhook(id, tenantOf(req));
    res.json({
      success: result.success,
      message: result.success ? 'Retry successful' : 'Retry failed',
      statusCode: result.statusCode
    });
  } catch (error: any) {
    const notFound = /not found/i.test(error.message);
    res.status(notFound ? 404 : 502).json({
      success: false,
      error: error.message
    });
  }
});

export const getWebhookStats = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId.toString();
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
});
