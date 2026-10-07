import { Request, Response, NextFunction } from 'express';
import { RagBot, Knowledge } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { ragIngestionService } from '../services/ragIngestionService.js';
import fs from 'fs';

/**
 * RAG Ingestion Controller
 * Manage knowledge sources for a bot
 */

export const uploadDocument = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId, botId } = req.params;
  const file = req.file;
  
  if (!file) {
    throw new AppError('No file uploaded', 400);
  }
  
  const bot = await RagBot.findOne({ 
    _id: botId, 
    projectId, 
    tenantId: req.tenantId 
  });
  
  if (!bot) {
    throw new AppError('Bot not found', 404);
  }
  
  try {
    const result = await ragIngestionService.ingestDocument(file.path, bot, file.originalname);
    
    // Clean up uploaded file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    
    res.json({
      success: true,
      message: `Document ingested successfully. Created ${result.chunksCreated} chunks.`,
      data: result
    });
  } catch (error: any) {
    // Clean up on error
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    throw new AppError(`Ingestion failed: ${error.message}`, 500);
  }
});

export const crawlUrl = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId, botId } = req.params;
  const { url, maxDepth } = req.body;
  
  if (!url) {
    throw new AppError('URL is required', 400);
  }
  
  const bot = await RagBot.findOne({ 
    _id: botId, 
    projectId, 
    tenantId: req.tenantId 
  });
  
  if (!bot) {
    throw new AppError('Bot not found', 404);
  }
  
  const result = await ragIngestionService.ingestUrl(url, bot, maxDepth || 1);
  
  res.json({
    success: true,
    message: `URL ingested successfully. Created ${result.chunksCreated} chunks.`,
    data: result
  });
});

export const syncCmsContent = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId, botId } = req.params;

  const bot = await RagBot.findOne({ 
    _id: botId, 
    projectId, 
    tenantId: req.tenantId 
  });
  
  if (!bot) {
    throw new AppError('Bot not found', 404);
  }
  
  const result = await ragIngestionService.ingestCmsContent(projectId, bot);
  
  res.json({
    success: true,
    message: `CMS Content synced successfully. Processed ${result.entriesProcessed} entries.`,
    data: result
  });
});

export const listSources = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId } = req.params;
  
  // We identify sources by unique sourceType + sourceUrl/sourceFile
  // For simplicity, we just return all knowledge entries for the project that have a sourceType
  const sources = await Knowledge.aggregate([
    { 
      $match: { 
        projectId: new Object(projectId),
        sourceType: { $ne: 'manual' } 
      } 
    },
    {
      $group: {
        _id: {
          type: '$sourceType',
          url: '$sourceUrl',
          file: '$sourceFile',
          hash: '$contentHash'
        },
        chunkCount: { $sum: 1 },
        totalCharacters: { $sum: '$characterCount' },
        createdAt: { $first: '$createdAt' }
      }
    },
    { $sort: { createdAt: -1 } }
  ]);
  
  res.json({
    success: true,
    data: sources.map(s => ({
      type: s._id.type,
      url: s._id.url,
      file: s._id.file,
      hash: s._id.hash,
      chunkCount: s.chunkCount,
      totalCharacters: s.totalCharacters,
      createdAt: s.createdAt
    }))
  });
});

export const deleteSource = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId } = req.params;
  const { type, hash } = req.query;
  
  if (!type || !hash) {
    throw new AppError('Source type and hash are required', 400);
  }
  
  const result = await Knowledge.deleteMany({
    projectId,
    sourceType: type as string,
    contentHash: hash as string
  });
  
  res.json({
    success: true,
    message: `Source deleted successfully. Removed ${result.deletedCount} chunks.`
  });
});
