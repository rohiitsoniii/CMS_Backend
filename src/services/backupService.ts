import { Types } from 'mongoose';
import fs from 'fs/promises';
import path from 'path';
import { AppError } from '../middleware/errorHandler.js';
import { runInTransaction } from '../utils/transactions.js';
import { Project } from '../models/Project.js';
import { Content } from '../models/Content.js';
import { MediaFile } from '../models/MediaFile.js';
import ContentType from '../models/ContentType.js';
import MediaFolder from '../models/MediaFolder.js';
import Workflow from '../models/Workflow.js';
import Webhook from '../models/Webhook.js';
import { Role } from '../models/Role.js';
import { TeamMember } from '../models/TeamMember.js';

interface BackupData {
  version: string;
  timestamp: Date;
  tenantId: string;
  projects: any[];
  contentTypes: any[];
  content: any[];
  mediaFiles: any[];
  mediaFolders: any[];
  workflows: any[];
  webhooks: any[];
  roles: any[];
  teamMembers: any[];
}

export class BackupService {
  private static backupDir = path.join(process.cwd(), 'backups');

  /**
   * Resolve a backup filename to an absolute path, rejecting any attempt to
   * traverse outside the backup directory (path traversal defence).
   */
  private static resolvePath(filename: string): string {
    if (
      typeof filename !== 'string' ||
      filename.length === 0 ||
      filename.length > 255 ||
      filename.includes('\0') ||
      /[\\/]/.test(filename) ||
      filename.includes('..') ||
      !filename.endsWith('.json')
    ) {
      throw new AppError('Invalid backup filename', 400);
    }
    const filepath = path.join(this.backupDir, filename);
    if (!filepath.startsWith(this.backupDir + path.sep)) {
      throw new AppError('Invalid backup filename', 400);
    }
    return filepath;
  }

  /**
   * Initialize backup directory
   */
  static async init(): Promise<void> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create backup directory:', error);
    }
  }

  /**
   * Create full backup for tenant
   */
  static async createBackup(tenantId: Types.ObjectId): Promise<{
    filename: string;
    size: number;
    path: string;
  }> {
    await this.init();

    const projectIds = (await Project.find({ tenantId }).select('_id').lean()).map(
      (p) => p._id
    );

    const data: BackupData = {
      version: '1.0.0',
      timestamp: new Date(),
      tenantId: String(tenantId),
      projects: await Project.find({ tenantId }).lean(),
      contentTypes: await ContentType.find({ tenantId }).lean(),
      content: await Content.find({ tenantId }).lean(),
      mediaFiles: await MediaFile.find({ tenantId }).lean(),
      mediaFolders: await MediaFolder.find({ tenantId }).lean(),
      workflows: await Workflow.find({ tenantId }).lean(),
      webhooks: await Webhook.find({ tenantId }).lean(),
      // Role and TeamMember are project-scoped (no tenantId field) — scope
      // them through the tenant's projects, otherwise they always back up empty.
      roles: await Role.find({ projectId: { $in: projectIds } }).lean(),
      teamMembers: await TeamMember.find({ projectId: { $in: projectIds } }).lean(),
    };

    const filename = `backup-${tenantId}-${Date.now()}.json`;
    const filepath = path.join(this.backupDir, filename);
    const jsonData = JSON.stringify(data, null, 2);

    await fs.writeFile(filepath, jsonData, 'utf-8');

    const stats = await fs.stat(filepath);

    return {
      filename,
      size: stats.size,
      path: filepath,
    };
  }

  /**
   * Create project-specific backup
   */
  static async createProjectBackup(
    projectId: Types.ObjectId,
    tenantId: Types.ObjectId
  ): Promise<{
    filename: string;
    size: number;
    path: string;
  }> {
    await this.init();

    const project = await Project.findOne({ _id: projectId, tenantId });
    if (!project) {
      throw new Error('Project not found');
    }

    const data = {
      version: '1.0.0',
      timestamp: new Date(),
      tenantId: String(tenantId),
      projectId: String(projectId),
      project: project.toObject(),
      contentTypes: await ContentType.find({ projectId, tenantId }).lean(),
      content: await Content.find({ projectId, tenantId }).lean(),
      workflows: await Workflow.find({ projectId, tenantId }).lean(),
      webhooks: await Webhook.find({ projectId, tenantId }).lean(),
      roles: await Role.find({ projectId }).lean(),
      teamMembers: await TeamMember.find({ projectId }).lean(),
    };

    const filename = `backup-project-${projectId}-${Date.now()}.json`;
    const filepath = path.join(this.backupDir, filename);
    const jsonData = JSON.stringify(data, null, 2);

    await fs.writeFile(filepath, jsonData, 'utf-8');

    const stats = await fs.stat(filepath);

    return {
      filename,
      size: stats.size,
      path: filepath,
    };
  }

  /**
   * Read just the head of a backup file to extract its tenantId without
   * loading the whole document (tenantId is serialized near the top).
   */
  private static async readTenantId(filepath: string): Promise<string | undefined> {
    const handle = await fs.open(filepath, 'r');
    try {
      const { buffer } = await handle.read(Buffer.alloc(2048), 0, 2048, 0);
      const match = buffer.toString('utf-8').match(/"tenantId"\s*:\s*"([^"]+)"/);
      return match?.[1];
    } finally {
      await handle.close();
    }
  }

  /**
   * Ensure the requesting tenant owns the backup file, else 403.
   * No-op when tenantId is absent (super-admin / system contexts).
   */
  private static async assertTenantOwnership(
    filepath: string,
    tenantId?: Types.ObjectId | string | null
  ): Promise<void> {
    if (!tenantId) return;
    let owner: string | undefined;
    try {
      owner = await this.readTenantId(filepath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        throw new AppError('Backup not found', 404);
      }
      owner = undefined;
    }
    if (owner !== String(tenantId)) {
      throw new AppError('Backup does not belong to this tenant', 403);
    }
  }

  /**
   * List backups. Scoped to a tenant; optionally to a single project.
   */
  static async listBackups(
    tenantId?: Types.ObjectId | string | null,
    projectId?: string
  ): Promise<
    Array<{
      filename: string;
      size: number;
      created: Date;
      type: 'full' | 'project';
    }>
  > {
    await this.init();

    const files = await fs.readdir(this.backupDir);
    const backups = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      if (projectId && !file.startsWith(`backup-project-${projectId}-`)) continue;

      const filepath = path.join(this.backupDir, file);
      if (tenantId) {
        const owner = await this.readTenantId(filepath).catch(() => undefined);
        if (owner !== String(tenantId)) continue;
      }
      const stats = await fs.stat(filepath);

      backups.push({
        filename: file,
        size: stats.size,
        created: stats.birthtime,
        type: file.includes('project') ? 'project' as const : 'full' as const,
      });
    }

    return backups.sort((a, b) => b.created.getTime() - a.created.getTime());
  }

  /**
   * Restore from backup.
   *
   * Reconciles state to match the backup: existing documents are removed for
   * the restored scope (whole tenant for a full backup, single project for a
   * project backup) and the backup's documents are re-inserted. Runs in one
   * transaction where supported, so a failed restore cannot half-wipe a tenant.
   */
  static async restoreBackup(
    filename: string,
    tenantId: Types.ObjectId
  ): Promise<void> {
    const filepath = this.resolvePath(filename);

    let jsonData: string;
    try {
      jsonData = await fs.readFile(filepath, 'utf-8');
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        throw new AppError('Backup not found', 404);
      }
      throw error;
    }

    let data: BackupData & { projectId?: string; project?: any };
    try {
      data = JSON.parse(jsonData);
    } catch {
      throw new AppError('Backup file is corrupted', 400);
    }

    // Verify tenant ID matches
    if (data.tenantId !== String(tenantId)) {
      throw new AppError('Backup tenant ID does not match', 403);
    }

    const projectIds = (data.projects ?? []).map((p: any) => p._id);

    await runInTransaction(async (session) => {
      const opts = session ? { session } : {};

      if (data.projectId) {
        // Project-scoped backup: only touch this project's data.
        const projectId = data.projectId;
        await Project.deleteMany({ _id: projectId, tenantId }, opts);
        await ContentType.deleteMany({ projectId, tenantId }, opts);
        await Content.deleteMany({ projectId, tenantId }, opts);
        await Workflow.deleteMany({ projectId, tenantId }, opts);
        await Webhook.deleteMany({ projectId, tenantId }, opts);
        await Role.deleteMany({ projectId }, opts);
        await TeamMember.deleteMany({ projectId }, opts);

        if (data.project) {
          await Project.insertMany([data.project], { ...opts, ordered: false });
        }
        if (data.contentTypes?.length)
          await ContentType.insertMany(data.contentTypes, { ...opts, ordered: false });
        if (data.content?.length)
          await Content.insertMany(data.content, { ...opts, ordered: false });
        if (data.workflows?.length)
          await Workflow.insertMany(data.workflows, { ...opts, ordered: false });
        if (data.webhooks?.length)
          await Webhook.insertMany(data.webhooks, { ...opts, ordered: false });
        if (data.roles?.length)
          await Role.insertMany(data.roles, { ...opts, ordered: false });
        if (data.teamMembers?.length)
          await TeamMember.insertMany(data.teamMembers, { ...opts, ordered: false });
        return;
      }

      // Full backup: replace the tenant's data with the backup's contents.
      await Project.deleteMany({ tenantId }, opts);
      await ContentType.deleteMany({ tenantId }, opts);
      await Content.deleteMany({ tenantId }, opts);
      await MediaFolder.deleteMany({ tenantId }, opts);
      await MediaFile.deleteMany({ tenantId }, opts);
      await Workflow.deleteMany({ tenantId }, opts);
      await Webhook.deleteMany({ tenantId }, opts);
      await Role.deleteMany({ projectId: { $in: projectIds } }, opts);
      await TeamMember.deleteMany({ projectId: { $in: projectIds } }, opts);

      if (data.projects?.length)
        await Project.insertMany(data.projects, { ...opts, ordered: false });
      if (data.contentTypes?.length)
        await ContentType.insertMany(data.contentTypes, { ...opts, ordered: false });
      if (data.content?.length)
        await Content.insertMany(data.content, { ...opts, ordered: false });
      if (data.mediaFolders?.length)
        await MediaFolder.insertMany(data.mediaFolders, { ...opts, ordered: false });
      if (data.mediaFiles?.length)
        await MediaFile.insertMany(data.mediaFiles, { ...opts, ordered: false });
      if (data.workflows?.length)
        await Workflow.insertMany(data.workflows, { ...opts, ordered: false });
      if (data.webhooks?.length)
        await Webhook.insertMany(data.webhooks, { ...opts, ordered: false });
      if (data.roles?.length)
        await Role.insertMany(data.roles, { ...opts, ordered: false });
      if (data.teamMembers?.length)
        await TeamMember.insertMany(data.teamMembers, { ...opts, ordered: false });
    });
  }

  /**
   * Delete backup file (must belong to the requesting tenant)
   */
  static async deleteBackup(
    filename: string,
    tenantId?: Types.ObjectId | string | null
  ): Promise<void> {
    const filepath = this.resolvePath(filename);
    await this.assertTenantOwnership(filepath, tenantId);
    try {
      await fs.unlink(filepath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        throw new AppError('Backup not found', 404);
      }
      throw error;
    }
  }

  /**
   * Download backup file path (validated + tenant-owned)
   */
  static async getBackupPath(
    filename: string,
    tenantId?: Types.ObjectId | string | null
  ): Promise<string> {
    const filepath = this.resolvePath(filename);
    await this.assertTenantOwnership(filepath, tenantId);
    return filepath;
  }

  /**
   * Auto-cleanup old backups (keep backups newer than daysToKeep)
   */
  static async cleanupOldBackups(daysToKeep: number = 30): Promise<number> {
    if (!Number.isFinite(daysToKeep) || daysToKeep < 1 || daysToKeep > 3650) {
      throw new AppError('daysToKeep must be a number between 1 and 3650', 400);
    }
    await this.init();

    const files = await fs.readdir(this.backupDir);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    let deletedCount = 0;

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filepath = path.join(this.backupDir, file);
        const stats = await fs.stat(filepath);

        if (stats.birthtime < cutoffDate) {
          await fs.unlink(filepath);
          deletedCount++;
        }
      }
    }

    return deletedCount;
  }
}
