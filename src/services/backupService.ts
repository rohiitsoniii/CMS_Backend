import { Types } from 'mongoose';
import fs from 'fs/promises';
import path from 'path';
import {
  Project,
  ContentType,
  Content,
  MediaFile,
  MediaFolder,
  Workflow,
  Webhook,
  Role,
  TeamMember,
} from '../models/index.js';

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
      roles: await Role.find({ tenantId }).lean(),
      teamMembers: await TeamMember.find({ tenantId }).lean(),
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
      teamMembers: await TeamMember.find({ projectId, tenantId }).lean(),
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
   * List all backups
   */
  static async listBackups(): Promise<
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
      if (file.endsWith('.json')) {
        const filepath = path.join(this.backupDir, file);
        const stats = await fs.stat(filepath);

        backups.push({
          filename: file,
          size: stats.size,
          created: stats.birthtime,
          type: file.includes('project') ? 'project' as const : 'full' as const,
        });
      }
    }

    return backups.sort((a, b) => b.created.getTime() - a.created.getTime());
  }

  /**
   * Restore from backup
   */
  static async restoreBackup(
    filename: string,
    tenantId: Types.ObjectId
  ): Promise<void> {
    const filepath = path.join(this.backupDir, filename);

    const jsonData = await fs.readFile(filepath, 'utf-8');
    const data: BackupData = JSON.parse(jsonData);

    // Verify tenant ID matches
    if (data.tenantId !== String(tenantId)) {
      throw new Error('Backup tenant ID does not match');
    }

    // Restore in order (dependencies first)
    if (data.projects) {
      await Project.insertMany(data.projects);
    }

    if (data.contentTypes) {
      await ContentType.insertMany(data.contentTypes);
    }

    if (data.content) {
      await Content.insertMany(data.content);
    }

    if (data.mediaFolders) {
      await MediaFolder.insertMany(data.mediaFolders);
    }

    if (data.mediaFiles) {
      await MediaFile.insertMany(data.mediaFiles);
    }

    if (data.workflows) {
      await Workflow.insertMany(data.workflows);
    }

    if (data.webhooks) {
      await Webhook.insertMany(data.webhooks);
    }

    if (data.roles) {
      await Role.insertMany(data.roles);
    }

    if (data.teamMembers) {
      await TeamMember.insertMany(data.teamMembers);
    }
  }

  /**
   * Delete backup file
   */
  static async deleteBackup(filename: string): Promise<void> {
    const filepath = path.join(this.backupDir, filename);
    await fs.unlink(filepath);
  }

  /**
   * Download backup file
   */
  static async getBackupPath(filename: string): Promise<string> {
    return path.join(this.backupDir, filename);
  }

  /**
   * Auto-cleanup old backups (keep last 30 days)
   */
  static async cleanupOldBackups(daysToKeep: number = 30): Promise<number> {
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
