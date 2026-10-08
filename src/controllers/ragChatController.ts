import { Request, Response, NextFunction } from 'express';
import { RagBot, RagConversation, Knowledge, Project } from '../models/index.js';
import { SMTPConfig } from '../models/SMTPConfig.js';
import { subscribe, sendConfirmationEmail } from '../services/emailMarketingService.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { isOriginAllowed } from '../middleware/apiKeyAuth.js';
import mongoose from 'mongoose';
import crypto from 'crypto';

/** Constant-time comparison of bot keys (no timing side channel). */
const keysMatch = (expected: string, given: string) => {
  const a = Buffer.from(String(expected || ''));
  const b = Buffer.from(String(given || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
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
  if (!keysMatch(bot.apiKey, apiKey)) {
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
  if (!keysMatch(bot.apiKey, apiKey)) {
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
      handoff: result.handoff,
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
  if (!keysMatch(bot.apiKey, apiKey)) throw new AppError('Invalid API Key', 401);

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

async function loadPublicBot(req: Request) {
  const { botSlug } = req.params;
  const apiKey = (req.headers['x-bot-key'] as string) || req.body?.apiKey || req.query.apiKey;
  if (!apiKey || typeof apiKey !== 'string') throw new AppError('apiKey is required', 400);
  const bot = await RagBot.findOne({
    $or: [
      { slug: botSlug, status: 'active' },
      { _id: mongoose.isValidObjectId(botSlug) ? botSlug : null, status: 'active' },
    ],
  });
  if (!bot) throw new AppError('Bot not found or inactive', 404);
  if (!keysMatch(bot.apiKey, apiKey)) throw new AppError('Invalid API Key', 401);
  const origin = req.get('origin');
  if (origin && bot.allowedOrigins?.length > 0 && !isOriginAllowed(origin, bot.allowedOrigins)) {
    throw new AppError('Origin not allowed', 403);
  }
  return bot;
}

/**
 * Visitor asks for a human. POST /api/v1/bots/:botSlug/handoff
 */
export const requestHandoff = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const bot = await loadPublicBot(req);
  const { sessionId, email, message } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string') throw new AppError('sessionId is required', 400);

  const conv = await RagConversation.findOneAndUpdate(
    { sessionId, botId: bot._id },
    {
      $setOnInsert: { botId: bot._id, projectId: bot.projectId, tenantId: bot.tenantId, sessionId },
      $set: {
        'handoff.status': 'requested',
        'handoff.requestedAt': new Date(),
        lastMessageAt: new Date(),
        ...(typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { visitorEmail: email.toLowerCase() } : {}),
      },
      $push: { messages: { role: 'system', content: 'Visitor asked to talk to a person.', timestamp: new Date() } },
      $inc: { unreadForAgent: 1 },
    },
    { upsert: true, new: true }
  );
  if (typeof message === 'string' && message.trim()) {
    await RagConversation.updateOne({ _id: conv._id }, { $push: { messages: { role: 'user', content: message.slice(0, 4000), timestamp: new Date() } } });
  }

  // Tell the team (in-app + email) — never blocks the visitor
  void (async () => {
    const { User } = await import('../models/User.js');
    const { mailerService } = await import('../services/mailerService.js');
    const team = await User.find({ tenantId: bot.tenantId, role: { $in: ['owner', 'admin', 'editor'] }, isActive: { $ne: false } }).select('email').lean();
    const link = `${(process.env.FRONTEND_URL || '').replace(/\/+$/, '')}/dashboard/project/${bot.projectId}/inbox?c=${conv._id}`;
    if (team.length) {
      await mailerService.send({
        category: 'system',
        to: team.map((u: any) => u.email),
        subject: `A visitor wants to talk to a person (${bot.name})`,
        html: `<p>A visitor on your website asked for a human in <strong>${bot.name}</strong>.</p><p><a href="${link}">Open the conversation</a></p>`,
      });
    }
  })().catch(() => undefined);

  res.json({ success: true, data: { status: 'requested' } });
});

/**
 * Widget polling for agent replies. GET /api/v1/bots/:botSlug/messages?sessionId=&after=
 */
export const pollMessages = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const bot = await loadPublicBot(req);
  const sessionId = String(req.query.sessionId || '');
  const after = req.query.after ? new Date(String(req.query.after)) : new Date(0);
  const conv = await RagConversation.findOne({ sessionId, botId: bot._id }).select('messages handoff').lean();
  if (!conv) {
    res.json({ success: true, data: { status: 'bot', messages: [] } });
    return;
  }
  const messages = (conv.messages || [])
    .filter((m: any) => (m.role === 'agent' || m.role === 'system') && new Date(m.timestamp) > after)
    .map((m: any) => ({ role: m.role, content: m.content, agentName: m.agentName, timestamp: m.timestamp }));
  res.json({ success: true, data: { status: conv.handoff?.status || 'bot', agentName: conv.handoff?.assignedName, messages } });
});
