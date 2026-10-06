import { Request, Response } from 'express';
import { RagBot, RagConversation, Knowledge } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import mongoose from 'mongoose';
import { ragQueryService } from '../services/ragQueryService.js';

/**
 * RAG Chat Controller (Public)
 * Handles interactions from the embeddable widget
 */

export const getWidgetConfig = asyncHandler(async (req: Request, res: Response) => {
  const { botSlug } = req.params;
  const { apiKey } = req.query;
  
  if (!apiKey) {
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
  if (origin && bot.allowedOrigins?.length > 0) {
    const isAllowed = bot.allowedOrigins.some(ao => origin.includes(ao));
    if (!isAllowed) {
      throw new AppError('Origin not allowed', 403);
    }
  }
  
  res.json({
    success: true,
    data: bot
  });
});

export const ragChat = asyncHandler(async (req: Request, res: Response) => {
  const { botSlug } = req.params;
  const { message, sessionId, apiKey, history = [] } = req.body;
  
  if (!message || !sessionId || !apiKey) {
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
  if (origin && bot.allowedOrigins?.length > 0) {
    const isAllowed = bot.allowedOrigins.some(ao => origin.includes(ao));
    if (!isAllowed) {
      throw new AppError('Origin not allowed', 403);
    }
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

export const submitFeedback = asyncHandler(async (req: Request, res: Response) => {
  const { botSlug } = req.params;
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
