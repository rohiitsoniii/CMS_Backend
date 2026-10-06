import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/index.js';
import { BackupService } from '../services/backupService.js';
import { AuditService } from '../services/AuditService.js';
import fs from 'fs';

/**
 * Create full backup
 * POST /api/v1/backups
 */
export const createBackup = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.body;

  let backup;
  if (projectId) {
    backup = await BackupService.createProjectBackup(projectId, req.tenantId);
  } else {
    backup = await BackupService.createBackup(req.tenantId);
  }

  await AuditService.log(req, 'backup.create', {
    type: 'Backup',
    id: backup.filename,
    name: backup.filename,
  }, { size: backup.size, projectId });

  res.status(201).json({
    success: true,
    message: 'Backup created successfully',
    data: { backup },
  });
});

/**
 * List all backups
 * GET /api/v1/backups
 */
export const listBackups = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const backups = await BackupService.listBackups();

  res.json({
    success: true,
    data: { backups },
  });
});

/**
 * Download backup
 * GET /api/v1/backups/:filename/download
 */
export const downloadBackup = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { filename } = req.params;

  const filepath = await BackupService.getBackupPath(filename);

  if (!fs.existsSync(filepath)) {
    throw new AppError('Backup not found', 404);
  }

  res.download(filepath, filename);
});

/**
 * Restore from backup
 * POST /api/v1/backups/:filename/restore
 */
export const restoreBackup = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { filename } = req.params;

  await BackupService.restoreBackup(filename, req.tenantId);

  await AuditService.log(req, 'backup.restore', {
    type: 'Backup',
    id: filename,
    name: filename,
  }, {});

  res.json({
    success: true,
    message: 'Backup restored successfully',
  });
});

/**
 * Delete backup
 * DELETE /api/v1/backups/:filename
 */
export const deleteBackup = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { filename } = req.params;

  await BackupService.deleteBackup(filename);

  await AuditService.log(req, 'backup.delete', {
    type: 'Backup',
    id: filename,
    name: filename,
  }, {});

  res.json({
    success: true,
    message: 'Backup deleted successfully',
  });
});

/**
 * Cleanup old backups
 * POST /api/v1/backups/cleanup
 */
export const cleanupBackups = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { daysToKeep = 30 } = req.body;

  const deletedCount = await BackupService.cleanupOldBackups(daysToKeep);

  await AuditService.log(req, 'backup.cleanup', {
    type: 'Backup',
    id: 'cleanup',
    name: 'Cleanup',
  }, { deletedCount, daysToKeep });

  res.json({
    success: true,
    message: `Cleaned up ${deletedCount} old backups`,
    data: { deletedCount },
  });
});
