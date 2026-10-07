import { Knowledge, RagBot, RagConversation } from '../models/index.js';
import { embeddingService, cosineSimilarity } from './embeddingService.js';
import aiService from './aiService.js';
import { runWithAIContext } from './aiGateway.js';

const MAX_VECTOR_CANDIDATES = 5000;

export class RagQueryService {
  /**
   * Hybrid retrieval: cosine similarity over stored chunk embeddings, topped
   * up with MongoDB text-search matches (and used alone when no embeddings).
   */
  async retrieveContext(botId: string, query: string, limit: number = 4): Promise<any[]> {
    const bot = await RagBot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    const threshold = bot.retrieval?.similarityThreshold ?? 0.2;
    const base = { projectId: bot.projectId, status: 'active' };
    const picked = new Map<string, any>();

    const queryVector = await embeddingService.generateEmbedding(query);
    if (queryVector.length > 0) {
      const candidates = await Knowledge.find({ ...base, 'embedding.0': { $exists: true } })
        .select('question answer sourceType sourceFile sourceUrl embedding')
        .limit(MAX_VECTOR_CANDIDATES)
        .lean();
      candidates
        .map((c: any) => ({ ...c, score: cosineSimilarity(queryVector, c.embedding || []) }))
        .filter((c) => c.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .forEach(({ embedding, ...c }: any) => picked.set(String(c._id), c));
    }

    if (picked.size < limit) {
      try {
        const textHits = await Knowledge.find({ ...base, $text: { $search: query } }, { score: { $meta: 'textScore' } })
          .select('question answer sourceType sourceFile sourceUrl')
          .sort({ score: { $meta: 'textScore' } })
          .limit(limit)
          .lean();
        for (const hit of textHits) {
          if (picked.size >= limit) break;
          if (!picked.has(String(hit._id))) picked.set(String(hit._id), hit);
        }
      } catch (err) {
        console.warn('[rag] text search unavailable:', (err as Error).message);
      }
    }

    const results = [...picked.values()];
    if (results.length) {
      Knowledge.updateMany({ _id: { $in: results.map((r) => r._id) } }, { $inc: { 'metrics.usageCount': 1 } }).catch(() => undefined);
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

    // Public widget calls carry no login — attribute AI usage to the bot owner
    return runWithAIContext(
      { tenantId: String(bot.tenantId), projectId: String(bot.projectId), feature: 'chatbot' },
      () => this.answer(bot, query, sessionId, history)
    );
  }

  private async answer(bot: any, query: string, sessionId: string, history: any[]): Promise<{ message: string; sources: any[] }> {
    const botId = String(bot._id);

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
