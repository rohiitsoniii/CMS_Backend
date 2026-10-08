import { Types } from 'mongoose';
import { getObjectStorage } from './objectStorage.js';
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

const PREFIX = 'backups';

export class BackupService {
  private static get storage() {
    return getObjectStorage();
  }

  /**
   * Validate a backup filename and map it to a storage key, rejecting any
   * attempt to traverse outside the backup prefix (path traversal defence).
   */
  private static resolveKey(filename: string): string {
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
    return `${PREFIX}/${filename}`;
  }

  /** Kept for existing callers; object storage needs no setup. */
  static async init(): Promise<void> {
    /* no-op */
  }

  private static async write(filename: string, data: unknown, tenantId: string) {
    const json = JSON.stringify(data, null, 2);
    const { size } = await this.storage.put(`${PREFIX}/${filename}`, json, {
      contentType: 'application/json',
      metadata: { tenantid: tenantId },
    });
    return { filename, size, path: `${this.storage.driver}:${PREFIX}/${filename}` };
  }

  /**
   * Create full backup for tenant
   */
  static async createBackup(tenantId: Types.ObjectId): Promise<{
    filename: string;
    size: number;
    path: string;
  }> {
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

    return this.write(`backup-${tenantId}-${Date.now()}.json`, data, String(tenantId));
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
    const project = await Project.findOne({ _id: projectId, tenantId });
    if (!project) {
      throw new AppError('Project not found', 404);
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

    return this.write(`backup-project-${projectId}-${Date.now()}.json`, data, String(tenantId));
  }

  /**
   * Owner of a backup: object metadata when available, else the tenantId
   * serialized near the top of the file (older backups / local driver).
   * Returns null when the backup does not exist.
   */
  private static async ownerOf(key: string): Promise<string | undefined | null> {
    const head = await this.storage.head(key);
    if (!head) return null;
    if (head.metadata?.tenantid) return head.metadata.tenantid;
    const start = await this.storage.readStart(key, 2048);
    const match = start?.toString('utf-8').match(/"tenantId"\s*:\s*"([^"]+)"/);
    return match?.[1];
  }

  /**
   * Ensure the requesting tenant owns the backup, else 403/404.
   * Ownership is skipped when tenantId is absent (super-admin / system contexts).
   */
  private static async assertTenantOwnership(
    key: string,
    tenantId?: Types.ObjectId | string | null
  ): Promise<void> {
    const owner = await this.ownerOf(key);
    if (owner === null) throw new AppError('Backup not found', 404);
    if (!tenantId) return;
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
    const objects = await this.storage.list(PREFIX);
    const backups = [];

    for (const obj of objects) {
      const file = obj.key.slice(PREFIX.length + 1);
      if (!file.endsWith('.json') || file.includes('/')) continue;
      if (projectId && !file.startsWith(`backup-project-${projectId}-`)) continue;
      if (tenantId) {
        const owner = await this.ownerOf(obj.key).catch(() => undefined);
        if (owner !== String(tenantId)) continue;
      }
      backups.push({
        filename: file,
        size: obj.size,
        created: obj.lastModified,
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
    const key = this.resolveKey(filename);

    const raw = await this.storage.get(key);
    if (!raw) {
      throw new AppError('Backup not found', 404);
    }

    let data: BackupData & { projectId?: string; project?: any };
    try {
      data = JSON.parse(raw.toString('utf-8'));
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
   * Delete backup (must belong to the requesting tenant)
   */
  static async deleteBackup(
    filename: string,
    tenantId?: Types.ObjectId | string | null
  ): Promise<void> {
    const key = this.resolveKey(filename);
    await this.assertTenantOwnership(key, tenantId);
    await this.storage.delete(key);
  }

  /**
   * Read a backup for download (validated + tenant-owned)
   */
  static async getBackupContent(
    filename: string,
    tenantId?: Types.ObjectId | string | null
  ): Promise<Buffer> {
    const key = this.resolveKey(filename);
    await this.assertTenantOwnership(key, tenantId);
    const data = await this.storage.get(key);
    if (!data) throw new AppError('Backup not found', 404);
    return data;
  }

  /**
   * Remove backups older than daysToKeep. Scoped to one tenant when given;
   * every tenant only for system jobs.
   */
  static async cleanupOldBackups(daysToKeep: number = 30, tenantId?: Types.ObjectId | string | null): Promise<number> {
    if (!Number.isFinite(daysToKeep) || daysToKeep < 1 || daysToKeep > 3650) {
      throw new AppError('daysToKeep must be a number between 1 and 3650', 400);
    }
    const cutoff = Date.now() - daysToKeep * 86_400_000;
    let deletedCount = 0;

    for (const obj of await this.storage.list(PREFIX)) {
      if (!obj.key.endsWith('.json') || obj.lastModified.getTime() >= cutoff) continue;
      if (tenantId) {
        const owner = await this.ownerOf(obj.key).catch(() => undefined);
        if (owner !== String(tenantId)) continue;
      }
      if (await this.storage.delete(obj.key)) deletedCount++;
    }

    return deletedCount;
  }
}
