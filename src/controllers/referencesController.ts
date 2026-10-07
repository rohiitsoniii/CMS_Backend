/**
 * References Controller
 * 
 * Handles content references and backlinks endpoints
 */

import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware';
import referencesService from '../services/referencesService';

/**
 * Get references from a content item
 */
export const getReferences = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;

  const references = await referencesService.getReferences(id);

  res.json({
    success: true,
    data: { references },
  });
});

/**
 * Get backlinks to a content item
 */
export const getBacklinks = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;

  const backlinks = await referencesService.getBacklinks(id);

  res.json({
    success: true,
    data: { backlinks },
  });
});

/**
 * Check if content can be deleted
 */
export const checkCanDelete = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;

  const result = await referencesService.canDelete(id);

  res.json({
    success: true,
    data: result,
  });
});

/**
 * Get reference graph
 */
export const getReferenceGraph = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const { depth = 2 } = req.query;

  const graph = await referencesService.getReferenceGraph(id, parseInt(depth as string));

  res.json({
    success: true,
    data: { graph },
  });
});

/**
 * Validate references
 */
export const validateReferences = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;

  const result = await referencesService.validateReferences(id);

  res.json({
    success: true,
    data: result,
  });
});

/**
 * Fix broken references
 */
export const fixBrokenReferences = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;

  const fixed = await referencesService.fixBrokenReferences(id);

  res.json({
    success: true,
    data: { fixed },
    message: `Fixed ${fixed} broken reference(s)`,
  });
});

/**
 * Get usage statistics
 */
export const getUsageStats = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { id } = req.params;

  const stats = await referencesService.getUsageStats(id);

  res.json({
    success: true,
    data: stats,
  });
});
