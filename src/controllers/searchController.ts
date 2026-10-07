/**
 * Search Controller
 * 
 * Handles search endpoints
 */

import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware';
import searchService from '../services/searchService.js';
import { embeddingService } from '../services/embeddingService.js';

/**
 * Search content
 */
export const searchContent = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId } = req.params;
  const {
    q,
    type,
    status,
    locale,
    tags,
    dateFrom,
    dateTo,
    dateField = 'createdAt',
    sortField,
    sortOrder = 'desc',
    page = 1,
    limit = 20,
    fuzzy = true,
    highlight = true,
    mode = 'text', // 'text', 'semantic', 'hybrid'
  } = req.query;

  if (!q) {
    res.status(400).json({
      success: false,
      message: 'Search query (q) is required',
    }); return;
  }

  const results = await searchService.search(projectId, {
    query: q as string,
    filters: {
      type: type ? (Array.isArray(type) ? type : [type]) as string[] : undefined,
      status: status ? (Array.isArray(status) ? status : [status]) as string[] : undefined,
      locale: locale ? (Array.isArray(locale) ? locale : [locale]) as string[] : undefined,
      tags: tags ? (Array.isArray(tags) ? tags : [tags]) as string[] : undefined,
      dateRange:
        dateFrom || dateTo
          ? {
              field: dateField as string,
              from: dateFrom ? new Date(dateFrom as string) : undefined,
              to: dateTo ? new Date(dateTo as string) : undefined,
            }
          : undefined,
    },
    sort: sortField
      ? {
          field: sortField as string,
          order: sortOrder as 'asc' | 'desc',
        }
      : undefined,
    page: parseInt(page as string),
    limit: parseInt(limit as string),
    fuzzy: fuzzy === 'true' || fuzzy === true,
    highlight: highlight === 'true' || highlight === true,
  });

  let finalResults = results;

  // Semantic Mode
  if (mode === 'semantic' || mode === 'hybrid') {
     const semanticResults = await embeddingService.semanticSearch(projectId, q as string, parseInt(limit as string));
     
      if (mode === 'semantic') {
         finalResults = { ...results, items: semanticResults, total: semanticResults.length } as any;
     } else {
         // Hybrid: combine text + semantic
         const combined = [...(results as any).items];
         const existingIds = new Set(combined.map(r => r._id?.toString()));
         
         semanticResults.forEach(sr => {
             if (!existingIds.has(sr._id?.toString())) {
                 combined.push(sr);
             }
         });
         finalResults = { ...results, items: combined.slice(0, parseInt(limit as string)), total: combined.length } as any;
     }
  }

  res.json({
    success: true,
    data: finalResults,
  });
});

/**
 * Autocomplete suggestions
 */
export const autocomplete = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId } = req.params;
  const { q, limit = 10 } = req.query;

  if (!q) {
    res.status(400).json({
      success: false,
      message: 'Query (q) is required',
    }); return;
  }

  const suggestions = await searchService.autocomplete(
    projectId,
    q as string,
    parseInt(limit as string)
  );

  res.json({
    success: true,
    data: { suggestions },
  });
});

/**
 * Reindex content
 */
export const reindex = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { projectId } = req.params;

  await searchService.reindexAll(projectId);

  res.json({
    success: true,
    message: 'Content reindexed successfully',
  });
});

/**
 * Get search status
 */
export const getSearchStatus = asyncHandler(async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const isAvailable = searchService.isAvailable();

  res.json({
    success: true,
    data: {
      elasticsearch: isAvailable,
      fallback: !isAvailable ? 'MongoDB' : null,
    },
  });
});
