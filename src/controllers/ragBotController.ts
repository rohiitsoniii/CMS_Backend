import { Request, Response, NextFunction } from 'express';
import { RagBot, Project, RagConversation } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import crypto from 'crypto';

/**
 * RAG Bot Controller
 * Manage AI chatbots for a project
 */

export const listBots = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId } = req.params;
  
  const bots = await RagBot.find({ 
    projectId, 
    tenantId: req.tenantId 
  }).sort({ createdAt: -1 });
  
  res.json({
    success: true,
    data: bots
  });
});

export const getBot = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId, botId } = req.params;
  
  const bot = await RagBot.findOne({ 
    _id: botId, 
    projectId, 
    tenantId: req.tenantId 
  });
  
  if (!bot) {
    throw new AppError('Bot not found', 404);
  }
  
  res.json({
    success: true,
    data: bot
  });
});

export const createBot = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId } = req.params;
  const botData = req.body;
  
  // Verify project
  const project = await Project.findOne({ 
    _id: projectId, 
    tenantId: req.tenantId 
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  // Generate a unique API Key
  const apiKey = `bot_${crypto.randomBytes(24).toString('hex')}`;
  
  const bot = await RagBot.create({
    ...botData,
    projectId,
    tenantId: req.tenantId,
    createdBy: req.userId,
    apiKey,
  });
  
  res.status(201).json({
    success: true,
    data: bot
  });
});

export const updateBot = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId, botId } = req.params;
  const updateData = req.body;
  
  const bot = await RagBot.findOneAndUpdate(
    { _id: botId, projectId, tenantId: req.tenantId },
    { ...updateData, updatedBy: req.userId },
    { new: true, runValidators: true }
  );
  
  if (!bot) {
    throw new AppError('Bot not found', 404);
  }
  
  res.json({
    success: true,
    data: bot
  });
});

export const deleteBot = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId, botId } = req.params;
  
  const bot = await RagBot.findOneAndDelete({ 
    _id: botId, 
    projectId, 
    tenantId: req.tenantId 
  });
  
  if (!bot) {
    throw new AppError('Bot not found', 404);
  }
  
  res.json({
    success: true,
    message: 'Bot deleted successfully'
  });
});

export const regenerateApiKey = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId, botId } = req.params;
  
  const apiKey = `bot_${crypto.randomBytes(24).toString('hex')}`;
  
  const bot = await RagBot.findOneAndUpdate(
    { _id: botId, projectId, tenantId: req.tenantId },
    { apiKey },
    { new: true }
  );
  
  if (!bot) {
    throw new AppError('Bot not found', 404);
  }
  
  res.json({
    success: true,
    data: { apiKey }
  });
});

export const getBotAnalytics = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId, botId } = req.params;

  const bot = await RagBot.findOne({ _id: botId, projectId, tenantId: req.tenantId });
  if (!bot) throw new AppError('Bot not found', 404);

  const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '7'), 10) || 7));
  const since = new Date(Date.now() - days * 86_400_000);

  const conversations = await RagConversation.find({ botId: bot._id, createdAt: { $gte: since } })
    .select('messages visitorEmail createdAt')
    .limit(5000)
    .lean();

  const byDay = new Map<string, { convos: number; msgs: number }>();
  for (let i = days - 1; i >= 0; i--) {
    byDay.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), { convos: 0, msgs: 0 });
  }
  const questions = new Map<string, { question: string; count: number }>();
  let helpful = 0;
  let notHelpful = 0;
  let messages = 0;
  let leads = 0;

  for (const conv of conversations as any[]) {
    const day = new Date(conv.createdAt).toISOString().slice(0, 10);
    const bucket = byDay.get(day);
    if (bucket) {
      bucket.convos++;
      bucket.msgs += conv.messages?.length || 0;
    }
    if (conv.visitorEmail) leads++;
    for (const m of conv.messages || []) {
      messages++;
      if (m.feedback === 'helpful') helpful++;
      if (m.feedback === 'not_helpful') notHelpful++;
      if (m.role === 'user') {
        const key = String(m.content).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
        const q = questions.get(key);
        if (q) q.count++;
        else questions.set(key, { question: String(m.content).slice(0, 200), count: 1 });
      }
    }
  }

  res.json({
    success: true,
    data: {
      overview: {
        totalConversations: conversations.length,
        totalMessages: messages,
        helpfulCount: helpful,
        notHelpfulCount: notHelpful,
        avgSatisfaction: bot.stats?.avgSatisfactionScore || 0,
        leadsCaptured: leads,
        allTimeConversations: bot.stats?.totalConversations || 0,
      },
      chartData: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      topQuestions: [...questions.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    },
  });
});

export const getEmbedCode = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId, botId } = req.params;
  
  const bot = await RagBot.findOne({ _id: botId, projectId, tenantId: req.tenantId });
  if (!bot) throw new AppError('Bot not found', 404);

  // widget.js is served by this API server
  const baseUrl = (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const embedCode = `<!-- Headless CMS RAG Bot Widget -->
<script 
  src="${baseUrl}/widget.js" 
  data-bot="${bot.slug}" 
  data-key="${bot.apiKey}"
  async
></script>`;

  res.json({
    success: true,
    data: { embedCode }
  });
});

/**
 * Questions the bot could not ground in any knowledge (no sources found) or
 * that visitors rated unhelpful — the owner's to-do list for the knowledge base.
 * GET /projects/:projectId/rag-bots/:botId/unanswered
 */
export const getUnansweredQuestions = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId, botId } = req.params;
  const bot = await RagBot.findOne({ _id: botId, projectId, tenantId: req.tenantId }).select('_id');
  if (!bot) throw new AppError('Bot not found', 404);

  const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '30'), 10) || 30));
  const conversations = await RagConversation.find({ botId: bot._id, createdAt: { $gte: new Date(Date.now() - days * 86_400_000) } })
    .select('messages visitorEmail createdAt')
    .sort({ createdAt: -1 })
    .limit(1000)
    .lean();

  const counts = new Map<string, { question: string; count: number; reason: 'no_sources' | 'unhelpful'; lastAskedAt: Date }>();
  for (const conv of conversations) {
    const msgs: any[] = (conv as any).messages || [];
    for (let i = 0; i < msgs.length - 1; i++) {
      const q = msgs[i];
      const a = msgs[i + 1];
      if (q.role !== 'user' || a.role !== 'assistant') continue;
      const reason = !a.sources?.length ? 'no_sources' : a.feedback === 'not_helpful' ? 'unhelpful' : null;
      if (!reason) continue;
      const key = String(q.content).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 300);
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
        if (q.timestamp && new Date(q.timestamp) > existing.lastAskedAt) existing.lastAskedAt = new Date(q.timestamp);
      } else {
        counts.set(key, { question: String(q.content).slice(0, 300), count: 1, reason, lastAskedAt: new Date(q.timestamp || (conv as any).createdAt) });
      }
    }
  }

  res.json({
    success: true,
    data: [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 100),
  });
});
