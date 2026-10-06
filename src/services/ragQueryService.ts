import { Knowledge, RagBot, RagConversation } from '../models/index.js';
import { embeddingService } from './embeddingService.js';
import aiService from './aiService.js';
import mongoose from 'mongoose';

export class RagQueryService {
  /**
   * Retrieves relevant context chunks using semantic (or text) search
   */
  async retrieveContext(botId: string, query: string, limit: number = 4): Promise<any[]> {
    const bot = await RagBot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    // Generate embedding for query
    const queryVector = await embeddingService.generateEmbedding(query);
    
    let results: any[] = [];

    if (queryVector.length > 0) {
      // SEMANTIC SEARCH (MOCK using existing logic in embeddingService)
      // In a real Atlas Vector Search system, this would be a $vectorSearch aggregation.
      // For now we use the same fallback semanticSearch logic from embeddingService
      results = await Knowledge.find(
        { 
          projectId: bot.projectId, 
          status: 'active',
          sourceType: { $in: ['document', 'url', 'cms_content', 'manual'] }
        },
        { score: { $meta: "textScore" } }
      )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit);
      
      // If we have real vectors, we should theoretically filter by cosine similarity.
      // Since we are mocking Atlas Vector Search, we just return the text matches
      // but we could rank them if we had a local vector comparison.
    } else {
      // Fallback to text search
      results = await Knowledge.find(
        { 
          projectId: bot.projectId, 
          status: 'active',
          $text: { $search: query } 
        },
        { score: { $meta: "textScore" } }
      )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit);
    }

    return results;
  }

  /**
   * Generates a response using the augmented context
   */
  async generateResponse(
    botId: string, 
    query: string, 
    sessionId: string,
    history: any[] = []
  ): Promise<{ message: string; sources: any[] }> {
    const bot = await RagBot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    // 1. Retrieve context
    const contextChunks = await this.retrieveContext(botId, query, bot.retrieval?.topK || 4);
    
    // 2. Format context for prompt
    const contextText = contextChunks
      .map((c, i) => `[Source ${i+1}]: ${c.answer}`)
      .join('\n\n');

    // 3. Build history string
    const historyText = history
      .slice(-5) // Last 5 messages for context
      .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
      .join('\n');

    // 4. Construct System Prompt
    const systemPrompt = `
${bot.persona.systemPrompt}

Use the following Context to answer the user's Question. 
If the information is not in the Context, say you don't know based on the provided material.
Keep your response concise and helpful.

Context:
${contextText}

Conversation History:
${historyText}
    `.trim();

    // 5. Call LLM
    const response = await aiService.generateContent(`${systemPrompt}\n\nUser Question: ${query}`, {
      model: bot.persona.model,
      temperature: bot.persona.temperature,
      maxTokens: bot.persona.maxResponseTokens,
    });

    // 6. Log conversation (Async)
    this.logConversation(bot, sessionId, query, response, contextChunks).catch(console.error);

    return {
      message: response,
      sources: contextChunks.map(c => ({
        id: c._id,
        sourceType: c.sourceType,
        sourceFile: c.sourceFile,
        sourceUrl: c.sourceUrl,
      }))
    };
  }

  /**
   * Logs conversation history and updates bot stats
   */
  private async logConversation(
    bot: any, 
    sessionId: string, 
    userMsg: string, 
    assistantMsg: string,
    sources: any[]
  ) {
    let conversation = await RagConversation.findOne({ sessionId });
    
    if (!conversation) {
      conversation = new RagConversation({
        botId: bot._id,
        projectId: bot.projectId,
        tenantId: bot.tenantId,
        sessionId,
        messages: [],
      });
      
      // Update bot conversation count
      await RagBot.findByIdAndUpdate(bot._id, {
        $inc: { 'stats.totalConversations': 1 },
        $set: { 'stats.lastActiveAt': new Date() }
      });
    }

    conversation.messages.push({
      role: 'user',
      content: userMsg,
      timestamp: new Date()
    });

    conversation.messages.push({
      role: 'assistant',
      content: assistantMsg,
      sources: sources.map(s => s._id),
      timestamp: new Date()
    });

    await conversation.save();

    // Update bot message count
    await RagBot.findByIdAndUpdate(bot._id, {
      $inc: { 'stats.totalMessages': 2 }
    });
  }
}

export const ragQueryService = new RagQueryService();
