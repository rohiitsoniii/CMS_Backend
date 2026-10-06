import { Request, Response } from 'express';
import { Knowledge, Project } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';

/**
 * Smart Chatbot Controller
 * Uses keyword matching and optional local LLM (Ollama)
 * 100% FREE - No paid APIs required!
 */

// Simple keyword-based similarity scoring
function calculateSimilarity(query: string, keywords: string[], question: string): number {
  const queryWords = query.toLowerCase().split(/\s+/);
  const questionWords = question.toLowerCase().split(/\s+/);
  const allKeywords = [...keywords.map(k => k.toLowerCase()), ...questionWords];
  
  let matches = 0;
  for (const word of queryWords) {
    if (word.length < 3) continue; // Skip short words
    for (const keyword of allKeywords) {
      if (keyword.includes(word) || word.includes(keyword)) {
        matches++;
        break;
      }
    }
  }
  
  return matches / Math.max(queryWords.length, 1);
}

// Find best matching knowledge base entries
async function findBestMatches(
  projectId: string,
  query: string,
  limit = 3
): Promise<Array<{ knowledge: any; score: number }>> {
  const allKnowledge = await Knowledge.find({
    projectId,
    status: 'active',
  });
  
  const scored = allKnowledge.map(kb => ({
    knowledge: kb,
    score: calculateSimilarity(query, kb.keywords, kb.question),
  }));
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  // Filter out low scores and return top matches
  return scored.filter(s => s.score > 0.2).slice(0, limit);
}

// Optional: Call local Ollama LLM
async function callOllama(
  systemPrompt: string,
  userMessage: string,
  context: string
): Promise<string | null> {
  try {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'llama3.2'; // Free local model
    
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `${systemPrompt}\n\nContext:\n${context}\n\nUser: ${userMessage}\n\nAssistant:`,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 200,
        },
      }),
    });
    
    if (!response.ok) {
      console.log('Ollama not available, using keyword matching');
      return null;
    }
    
    const data = await response.json() as { response?: string };
    return data.response || null;
  } catch (error) {
    // Ollama not running, fall back to keyword matching
    console.log('Ollama not available, using keyword matching');
    return null;
  }
}

/**
 * Chat with AI bot
 * POST /api/v1/deliver/:projectSlug/chat
 */
export const chatWithBot = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectSlug } = req.params;
  const { message, sessionId } = req.body;
  
  if (!message) {
    throw new AppError('Message is required', 400);
  }
  
  const project = await Project.findOne({
    slug: projectSlug,
    status: 'active',
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  if (!project.chatbot?.enabled) {
    throw new AppError('Chatbot is not enabled for this project', 400);
  }
  
  // Find matching knowledge base entries
  const matches = await findBestMatches(project._id.toString(), message);
  
  let response: string;
  let matchedKnowledge = null;
  let usedAI = false;
  
  if (matches.length > 0 && matches[0].score > 0.4) {
    // Good match found - use knowledge base answer
    matchedKnowledge = matches[0].knowledge;
    response = matchedKnowledge.answer;
    
    // Record usage
    matchedKnowledge.metrics.usageCount += 1;
    matchedKnowledge.metrics.lastUsedAt = new Date();
    await matchedKnowledge.save();
  } else if (project.chatbot.aiEnabled && matches.length > 0) {
    // Try to use Ollama for AI-enhanced response
    const context = matches
      .map(m => `Q: ${m.knowledge.question}\nA: ${m.knowledge.answer}`)
      .join('\n\n');
    
    const aiResponse = await callOllama(
      project.chatbot.systemPrompt || `You are ${project.chatbot.name}, a helpful assistant. Answer based on the provided context. If you don't know, say so politely.`,
      message,
      context
    );
    
    if (aiResponse) {
      response = aiResponse;
      usedAI = true;
    } else {
      // Fallback to best match or fallback message
      if (matches.length > 0 && matches[0].score > 0.2) {
        matchedKnowledge = matches[0].knowledge;
        response = matchedKnowledge.answer;
      } else {
        response = project.chatbot.fallbackMessage;
      }
    }
  } else {
    // No match - use fallback
    response = project.chatbot.fallbackMessage || 
      "I'm not sure about that. Would you like to speak with a human?";
  }
  
  res.json({
    success: true,
    data: {
      message: response,
      sessionId: sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      matchedQuestion: matchedKnowledge?.question,
      followUp: matchedKnowledge?.followUp,
      suggestions: project.chatbot.quickActions,
      usedAI,
    },
  });
});

/**
 * Get chat suggestions based on popular questions
 * GET /api/v1/deliver/:projectSlug/chat/suggestions
 */
export const getChatSuggestions = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectSlug } = req.params;
  
  const project = await Project.findOne({
    slug: projectSlug,
    status: 'active',
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  // Get most used questions
  const popularQuestions = await Knowledge.find({
    projectId: project._id,
    status: 'active',
  })
    .sort({ 'metrics.usageCount': -1, priority: -1 })
    .limit(5)
    .select('question category');
  
  res.json({
    success: true,
    data: {
      suggestions: popularQuestions.map(q => ({
        question: q.question,
        category: q.category,
      })),
    },
  });
});

/**
 * Rate chatbot response
 * POST /api/v1/deliver/:projectSlug/chat/rate
 */
export const rateChatResponse = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectSlug } = req.params;
  const { knowledgeId, helpful } = req.body;
  
  if (!knowledgeId || typeof helpful !== 'boolean') {
    throw new AppError('knowledgeId and helpful (boolean) are required', 400);
  }
  
  const knowledge = await Knowledge.findById(knowledgeId);
  
  if (!knowledge) {
    throw new AppError('Knowledge entry not found', 404);
  }
  
  if (helpful) {
    knowledge.metrics.helpfulCount += 1;
  } else {
    knowledge.metrics.notHelpfulCount += 1;
  }
  
  await knowledge.save();
  
  res.json({
    success: true,
    message: 'Thank you for your feedback!',
  });
});
