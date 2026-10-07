import { Request, Response, NextFunction } from 'express';
import { asyncHandler, AppError } from '../middleware/index.js';
import aiService from '../services/aiService.js';
import { Content } from '../models/index.js';
import mongoose from 'mongoose';

export const queryDatabase = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { query, projectId } = req.body;

  if (!query) {
    throw new AppError('Natural language query is required', 400);
  }
  
  if (!projectId) {
    throw new AppError('Project ID is required', 400);
  }

  // 1. Generate MongoDB Query securely via AI logic
  const prompt = `Convert this natural language query into a raw MongoDB query inside a JSON object: 
"${query}"

Important Rules:
- Return ONLY the raw valid JSON corresponding to the 'filter' body of the Mongoose query.
- Use explicit field conversions where needed (e.g. status: 'published').
- The base schema is Content (projectId, tenantId, status, type, data, isDeleted). Don't include projectId or tenantId matching, I will add that manually.
- Output ONLY JSON. Do not include markdown \`\`\` blocks or any text besides JSON.

Example Input: "show me published articles from the blog"
Example Output: {"status": "published", "type": "blog"}
`;
  
  const rawAiResponse = await aiService.generateContent(prompt, { maxTokens: 200, temperature: 0.1 });
  
  let mongoQuery = {};
  try {
     const cleanedResponse = rawAiResponse.trim().replace(/^```json/i, '').replace(/```$/i, '').trim();
     mongoQuery = JSON.parse(cleanedResponse);
  } catch (error) {
     console.error("NLQ Parse Error", error, rawAiResponse);
     throw new AppError('Could not reliably parse query from AI response', 500);
  }
  
  // 2. Attach tenant safety and execute
  const safeQuery = {
      ...mongoQuery,
      projectId: new mongoose.Types.ObjectId(projectId as string),
      tenantId: new mongoose.Types.ObjectId(req.tenantId as string),
      isDeleted: false
  };

  const results = await Content.find(safeQuery).limit(50).lean().exec();

  res.json({
    success: true,
    data: {
      generatedQuery: mongoQuery,
      matchCount: results.length,
      items: results
    }
  });
});
