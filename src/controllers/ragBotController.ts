import { Request, Response } from 'express';
import { RagBot, Project } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import crypto from 'crypto';

/**
 * RAG Bot Controller
 * Manage AI chatbots for a project
 */

export const listBots = asyncHandler(async (req: Request, res: Response) => {
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

export const getBot = asyncHandler(async (req: Request, res: Response) => {
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

export const createBot = asyncHandler(async (req: Request, res: Response) => {
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

export const updateBot = asyncHandler(async (req: Request, res: Response) => {
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

export const deleteBot = asyncHandler(async (req: Request, res: Response) => {
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

export const regenerateApiKey = asyncHandler(async (req: Request, res: Response) => {
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

export const getBotAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { projectId, botId } = req.params;
  
  const bot = await RagBot.findOne({ _id: botId, projectId, tenantId: req.tenantId });
  if (!bot) throw new AppError('Bot not found', 404);

  // For now return bot stats and sample chart data
  // In a real app we'd aggregate RagConversation
  res.json({
    success: true,
    data: {
      overview: bot.stats,
      chartData: [
        { date: new Date().toISOString().split('T')[0], convos: bot.stats.totalConversations, msgs: bot.stats.totalMessages }
      ],
      topQuestions: []
    }
  });
});

export const getEmbedCode = asyncHandler(async (req: Request, res: Response) => {
  const { projectId, botId } = req.params;
  
  const bot = await RagBot.findOne({ _id: botId, projectId, tenantId: req.tenantId });
  if (!bot) throw new AppError('Bot not found', 404);

  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
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
