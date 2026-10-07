import { Request, Response, NextFunction } from 'express';
import { RagBot, RagConversation, Knowledge, Project } from '../models/index.js';
import { SMTPConfig } from '../models/SMTPConfig.js';
import { subscribe, sendConfirmationEmail } from '../services/emailMarketingService.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { isOriginAllowed } from '../middleware/apiKeyAuth.js';
import mongoose from 'mongoose';
import { ragQueryService } from '../services/ragQueryService.js';

/**
 * RAG Chat Controller (Public)
 * Handles interactions from the embeddable widget
 */

export const getWidgetConfig = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { botSlug } = req.params;
  // Prefer the x-bot-key header so keys stay out of URLs/logs; ?apiKey= kept for old embeds
  const apiKey = (req.headers['x-bot-key'] as string) || req.query.apiKey;

  if (!apiKey || typeof apiKey !== 'string') {
    throw new AppError('apiKey is required', 400);
  }

  const bot = await RagBot.findOne({ 
    $or: [
      { slug: botSlug, status: 'active' },
      { _id: mongoose.isValidObjectId(botSlug) ? botSlug : null, status: 'active' }
    ]
  })
    .select('name description widget persona.language allowedOrigins apiKey');
    
  if (!bot) {
    throw new AppError('Bot not found or inactive', 404);
  }

  // Validate API Key
  if (bot.apiKey !== apiKey) {
    throw new AppError('Invalid API Key', 401);
  }

  // Validate CORS (Origin check) - optional for config fetch but good for security
  const origin = req.get('origin');
  if (origin && bot.allowedOrigins?.length > 0 && !isOriginAllowed(origin, bot.allowedOrigins)) {
    throw new AppError('Origin not allowed', 403);
  }
  
  res.json({
    success: true,
    data: bot
  });
});

export const ragChat = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { botSlug } = req.params;
  const { message, sessionId, history = [] } = req.body;
  const apiKey = (req.headers['x-bot-key'] as string) || req.body.apiKey;

  if (!message || !sessionId || !apiKey || typeof apiKey !== 'string') {
    throw new AppError('message, sessionId, and apiKey are required', 400);
  }
  
  const bot = await RagBot.findOne({ 
    $or: [
      { slug: botSlug, status: 'active' },
      { _id: mongoose.isValidObjectId(botSlug) ? botSlug : null, status: 'active' }
    ]
  });
  
  if (!bot) {
    throw new AppError('Bot not found or inactive', 404);
  }
  
  // Validate API Key
  if (bot.apiKey !== apiKey) {
    throw new AppError('Invalid API Key', 401);
  }
  
  // Validate CORS (Origin check)
  const origin = req.get('origin');
  if (origin && bot.allowedOrigins?.length > 0 && !isOriginAllowed(origin, bot.allowedOrigins)) {
    throw new AppError('Origin not allowed', 403);
  }
  
  // Process RAG Query
  const result = await ragQueryService.generateResponse(
    bot._id.toString(),
    message,
    sessionId,
    history
  );
  
  res.json({
    success: true,
    data: {
      message: result.message,
      sources: result.sources,
      sessionId
    }
  });
});

export const submitFeedback = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { sessionId, messageIndex, feedback } = req.body; // feedback: 'helpful' | 'not_helpful'
  
  if (!sessionId || messageIndex === undefined || !feedback) {
    throw new AppError('sessionId, messageIndex, and feedback are required', 400);
  }
  
  const conversation = await RagConversation.findOne({ sessionId });
  
  if (!conversation) {
    throw new AppError('Conversation not found', 404);
  }
  
  // Find the message in the conversation (assuming it's a list)
  if (conversation.messages[messageIndex]) {
    conversation.messages[messageIndex].feedback = feedback;
    
    // Also update any sources linked to this message if they was helpful
    if (feedback === 'helpful' && conversation.messages[messageIndex].sources) {
      const sourceIds = conversation.messages[messageIndex].sources;
      await Knowledge.updateMany(
        { _id: { $in: sourceIds } },
        { $inc: { 'metrics.helpfulCount': 1 } }
      );
    } else if (feedback === 'not_helpful' && conversation.messages[messageIndex].sources) {
       const sourceIds = conversation.messages[messageIndex].sources;
       await Knowledge.updateMany(
         { _id: { $in: sourceIds } },
         { $inc: { 'metrics.notHelpfulCount': 1 } }
       );
    }
    
    await conversation.save();
  }
  
  // Update bot satisfaction metrics can be done here too
  
  res.json({
    success: true,
    message: 'Feedback submitted successfully'
  });
});

/**
 * Lead capture from the widget: visitor leaves their email → added to the
 * project's email audience (source "chatbot") and linked to the conversation.
 * POST /api/v1/bots/:botSlug/lead
 */
export const captureLead = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { botSlug } = req.params;
  const apiKey = (req.headers['x-bot-key'] as string) || req.body?.apiKey;
  const { email, name, sessionId, consent } = req.body || {};

  if (!apiKey || typeof apiKey !== 'string') throw new AppError('apiKey is required', 400);

  const bot = await RagBot.findOne({
    $or: [
      { slug: botSlug, status: 'active' },
      { _id: mongoose.isValidObjectId(botSlug) ? botSlug : null, status: 'active' }
    ]
  });
  if (!bot) throw new AppError('Bot not found or inactive', 404);
  if (bot.apiKey !== apiKey) throw new AppError('Invalid API Key', 401);

  const origin = req.get('origin');
  if (origin && bot.allowedOrigins?.length > 0 && !isOriginAllowed(origin, bot.allowedOrigins)) {
    throw new AppError('Origin not allowed', 403);
  }

  const settings = await SMTPConfig.findOne({ projectId: bot.projectId }).select('doubleOptIn').lean();
  let result;
  try {
    result = await subscribe(
      bot.projectId,
      {
        email,
        name: typeof name === 'string' ? name : undefined,
        tags: ['chatbot', bot.slug].filter(Boolean),
        source: 'chatbot',
        sourceDetail: bot.name,
        consentIp: req.ip,
        consentText: typeof consent === 'string' ? consent : 'Shared email in chatbot widget',
      },
      { doubleOptIn: Boolean(settings?.doubleOptIn) }
    );
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  if (typeof sessionId === 'string' && sessionId) {
    await RagConversation.updateOne(
      { sessionId, botId: bot._id },
      { $set: { visitorEmail: result.subscriber.email } }
    );
  }

  if (result.needsConfirmation) {
    const project = await Project.findById(bot.projectId).select('name').lean();
    sendConfirmationEmail(bot.projectId, result.subscriber, (project as any)?.name || bot.name).catch(() => undefined);
  }

  res.json({ success: true, data: { needsConfirmation: result.needsConfirmation } });
});
