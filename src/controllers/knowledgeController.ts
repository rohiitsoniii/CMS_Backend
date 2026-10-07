import { Request, Response } from 'express';
import { Knowledge, Project } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { escapeSearchTerm } from '../utils/queryBuilder.js';

/**
 * Knowledge Base Controller
 * Manage Q&A pairs for the AI chatbot
 */

/**
 * Get all knowledge base entries
 * GET /api/v1/projects/:projectId/knowledge
 */
export const getKnowledgeList = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  const { category, search, status, page = 1, limit = 20 } = req.query;
  
  // Verify project access
  const project = await Project.findOne({
    _id: projectId,
    tenantId: req.tenantId,
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  const query: Record<string, unknown> = { projectId };
  
  if (category) query.category = category;
  if (status) query.status = status;
  if (search && typeof search === 'string') {
    const term = escapeSearchTerm(search);
    query.$or = [
      { question: { $regex: term, $options: 'i' } },
      { answer: { $regex: term, $options: 'i' } },
      { keywords: { $in: [new RegExp(term, 'i')] } },
    ];
  }
  
  const skip = (Number(page) - 1) * Number(limit);
  
  const [entries, total] = await Promise.all([
    Knowledge.find(query)
      .sort({ priority: -1, 'metrics.usageCount': -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Knowledge.countDocuments(query),
  ]);
  
  // Get categories with counts
  const categories = await Knowledge.aggregate([
    { $match: { projectId: project._id } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  
  res.json({
    success: true,
    data: {
      entries,
      categories: categories.map(c => ({ name: c._id, count: c.count })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/**
 * Get single knowledge entry
 * GET /api/v1/projects/:projectId/knowledge/:id
 */
export const getKnowledge = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId, id } = req.params;
  
  const entry = await Knowledge.findOne({
    _id: id,
    projectId,
  });
  
  if (!entry) {
    throw new AppError('Knowledge entry not found', 404);
  }
  
  res.json({
    success: true,
    data: { entry },
  });
});

/**
 * Create knowledge entry
 * POST /api/v1/projects/:projectId/knowledge
 */
export const createKnowledge = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  const { question, answer, category, keywords, variations, followUp, richAnswer, priority } = req.body;
  
  // Verify project access
  const project = await Project.findOne({
    _id: projectId,
    tenantId: req.tenantId,
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  // Auto-generate keywords from question if not provided
  const autoKeywords = keywords || question
    .toLowerCase()
    .split(/\s+/)
    .filter((word: string) => word.length > 3)
    .slice(0, 10);
  
  const entry = await Knowledge.create({
    projectId,
    tenantId: req.tenantId,
    question,
    answer,
    category: category || 'general',
    keywords: autoKeywords,
    variations: variations || [],
    followUp,
    richAnswer,
    priority: priority || 0,
    status: 'active',
    createdBy: req.userId,
  });
  
  res.status(201).json({
    success: true,
    message: 'Knowledge entry created successfully',
    data: { entry },
  });
});

/**
 * Update knowledge entry
 * PUT /api/v1/projects/:projectId/knowledge/:id
 */
export const updateKnowledge = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId, id } = req.params;
  const { question, answer, category, keywords, variations, followUp, richAnswer, priority, status } = req.body;
  
  const entry = await Knowledge.findOneAndUpdate(
    { _id: id, projectId },
    {
      question,
      answer,
      category,
      keywords,
      variations,
      followUp,
      richAnswer,
      priority,
      status,
      updatedBy: req.userId,
    },
    { new: true, runValidators: true }
  );
  
  if (!entry) {
    throw new AppError('Knowledge entry not found', 404);
  }
  
  res.json({
    success: true,
    message: 'Knowledge entry updated successfully',
    data: { entry },
  });
});

/**
 * Delete knowledge entry
 * DELETE /api/v1/projects/:projectId/knowledge/:id
 */
export const deleteKnowledge = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId, id } = req.params;
  
  const entry = await Knowledge.findOneAndDelete({ _id: id, projectId });
  
  if (!entry) {
    throw new AppError('Knowledge entry not found', 404);
  }
  
  res.json({
    success: true,
    message: 'Knowledge entry deleted successfully',
  });
});

/**
 * Bulk import knowledge entries
 * POST /api/v1/projects/:projectId/knowledge/import
 */
export const importKnowledge = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  const { entries } = req.body;
  
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new AppError('Entries array is required', 400);
  }
  
  if (entries.length > 100) {
    throw new AppError('Maximum 100 entries per import', 400);
  }
  
  // Verify project access
  const project = await Project.findOne({
    _id: projectId,
    tenantId: req.tenantId,
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  const created: unknown[] = [];
  const errors: { index: number; error: string }[] = [];
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      if (!entry.question || !entry.answer) {
        errors.push({ index: i, error: 'Question and answer are required' });
        continue;
      }
      
      const autoKeywords = entry.keywords || entry.question
        .toLowerCase()
        .split(/\s+/)
        .filter((word: string) => word.length > 3)
        .slice(0, 10);
      
      const newEntry = await Knowledge.create({
        projectId,
        tenantId: req.tenantId,
        question: entry.question,
        answer: entry.answer,
        category: entry.category || 'general',
        keywords: autoKeywords,
        variations: entry.variations || [],
        status: 'active',
        createdBy: req.userId,
      });
      
      created.push(newEntry);
    } catch (err: unknown) {
      const error = err as Error;
      errors.push({ index: i, error: error.message });
    }
  }
  
  res.status(201).json({
    success: true,
    message: `Imported ${created.length} entries`,
    data: {
      created: created.length,
      errors: errors.length,
      errorDetails: errors,
    },
  });
});

/**
 * Get knowledge base statistics
 * GET /api/v1/projects/:projectId/knowledge/stats
 */
export const getKnowledgeStats = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  
  const [
    totalCount,
    activeCount,
    categoryStats,
    topUsed,
    recentlyAdded,
  ] = await Promise.all([
    Knowledge.countDocuments({ projectId }),
    Knowledge.countDocuments({ projectId, status: 'active' }),
    Knowledge.aggregate([
      { $match: { projectId: projectId } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Knowledge.find({ projectId, status: 'active' })
      .sort({ 'metrics.usageCount': -1 })
      .limit(5)
      .select('question metrics.usageCount'),
    Knowledge.find({ projectId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('question createdAt'),
  ]);
  
  res.json({
    success: true,
    data: {
      total: totalCount,
      active: activeCount,
      categories: categoryStats.map(c => ({ name: c._id, count: c.count })),
      topUsed: topUsed.map(q => ({
        question: q.question,
        usageCount: q.metrics.usageCount,
      })),
      recentlyAdded: recentlyAdded.map(q => ({
        question: q.question,
        createdAt: q.createdAt,
      })),
    },
  });
});

/**
 * Train/test the chatbot with a query
 * POST /api/v1/projects/:projectId/knowledge/test
 */
export const testChatbot = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  const { query } = req.body;
  
  if (!query) {
    throw new AppError('Query is required', 400);
  }
  
  // Find all knowledge entries
  const allKnowledge = await Knowledge.find({
    projectId,
    status: 'active',
  });
  
  // Calculate similarity scores
  const queryWords = query.toLowerCase().split(/\s+/);
  
  const scored = allKnowledge.map(kb => {
    const questionWords = kb.question.toLowerCase().split(/\s+/);
    const allKeywords = [...kb.keywords.map((k: string) => k.toLowerCase()), ...questionWords];
    
    let matches = 0;
    for (const word of queryWords) {
      if (word.length < 3) continue;
      for (const keyword of allKeywords) {
        if (keyword.includes(word) || word.includes(keyword)) {
          matches++;
          break;
        }
      }
    }
    
    return {
      question: kb.question,
      answer: kb.answer,
      score: matches / Math.max(queryWords.length, 1),
      keywords: kb.keywords,
    };
  });
  
  // Sort by score
  scored.sort((a, b) => b.score - a.score);
  
  res.json({
    success: true,
    data: {
      query,
      matches: scored.slice(0, 5),
      bestMatch: scored[0]?.score > 0.3 ? scored[0] : null,
    },
  });
});
