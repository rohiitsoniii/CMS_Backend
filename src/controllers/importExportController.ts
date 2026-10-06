import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/index.js';
import { ImportExportService } from '../services/importExportService.js';
import { AuditService } from '../services/AuditService.js';
import mongoose from 'mongoose';

/**
 * Export content
 * GET /api/v1/projects/:projectId/export
 */
export const exportContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  const { contentTypeId, format = 'json', includeRelationships } = req.query;

  const options = {
    projectId: new mongoose.Types.ObjectId(projectId),
    contentTypeId: contentTypeId ? new mongoose.Types.ObjectId(contentTypeId as string) : undefined,
    format: format as 'json' | 'csv',
    includeRelationships: includeRelationships === 'true',
  };

  if (format === 'csv') {
    const csv = await ImportExportService.exportToCSV(options);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=content-export-${Date.now()}.csv`);
    res.send(csv);
  } else {
    const data = await ImportExportService.exportToJSON(options);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=content-export-${Date.now()}.json`);
    res.json(data);
  }

  await AuditService.log(req, 'content.export', {
    type: 'Content',
    id: projectId,
    name: 'Export',
  }, { format, contentTypeId });
});

/**
 * Import content
 * POST /api/v1/projects/:projectId/import
 */
export const importContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  const { contentTypeId, data, format = 'json', overwrite = false } = req.body;

  if (!data) {
    throw new AppError('Data is required', 400);
  }

  if (!contentTypeId) {
    throw new AppError('Content type ID is required', 400);
  }

  // Validate data
  if (format === 'json') {
    const validation = ImportExportService.validateImportData(data);
    if (!validation.valid) {
      throw new AppError(`Validation failed: ${validation.errors.join(', ')}`, 400);
    }
  }

  const options = {
    projectId: new mongoose.Types.ObjectId(projectId),
    contentTypeId: new mongoose.Types.ObjectId(contentTypeId),
    tenantId: req.tenantId,
    userId: new mongoose.Types.ObjectId(req.userId),
    overwrite,
  };

  let results;
  if (format === 'csv') {
    results = await ImportExportService.importFromCSV(data, options);
  } else {
    results = await ImportExportService.importFromJSON(data, options);
  }

  await AuditService.log(req, 'content.import', {
    type: 'Content',
    id: projectId,
    name: 'Import',
  }, { ...results, format, contentTypeId });

  res.json({
    success: true,
    message: `Import completed: ${results.imported} imported, ${results.updated} updated, ${results.failed} failed`,
    data: results,
  });
});

/**
 * Validate import data
 * POST /api/v1/projects/:projectId/import/validate
 */
export const validateImport = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { data } = req.body;

  if (!data) {
    throw new AppError('Data is required', 400);
  }

  const validation = ImportExportService.validateImportData(data);

  res.json({
    success: validation.valid,
    data: validation,
  });
});
