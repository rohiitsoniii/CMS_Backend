/**
 * Environment Service
 * 
 * Manages environments and content promotion between them
 */

import { Environment } from '../models/Environment';
import { Content } from '../models/Content';
import { Types } from 'mongoose';

interface PromoteOptions {
  contentIds?: string[];
  includeRelated?: boolean;
  overwrite?: boolean;
}

interface SyncResult {
  promoted: number;
  failed: number;
  errors: string[];
}

class EnvironmentService {
  /**
   * Create default environments for a project
   */
  async createDefaultEnvironments(projectId: string, userId: string) {
    const environments = [
      {
        projectId,
        name: 'Development',
        slug: 'development',
        type: 'development' as const,
        description: 'Development environment for testing',
        isDefault: true,
        isPublic: false,
        autoSync: false,
        createdBy: userId,
      },
      {
        projectId,
        name: 'Staging',
        slug: 'staging',
        type: 'staging' as const,
        description: 'Staging environment for pre-production testing',
        isDefault: false,
        isPublic: false,
        autoSync: false,
        createdBy: userId,
      },
      {
        projectId,
        name: 'Production',
        slug: 'production',
        type: 'production' as const,
        description: 'Production environment',
        isDefault: false,
        isPublic: true,
        autoSync: false,
        createdBy: userId,
      },
    ];

    const created = await Environment.insertMany(environments);
    console.log(`✅ Created ${created.length} default environments`);
    
    return created;
  }

  /**
   * Get all environments for a project
   */
  async getEnvironments(projectId: string) {
    return Environment.find({ projectId, isActive: true })
      .populate('createdBy', 'name email')
      .populate('syncFrom', 'name slug')
      .sort({ type: 1, createdAt: 1 });
  }

  /**
   * Get environment by ID
   */
  async getEnvironment(environmentId: string) {
    return Environment.findById(environmentId)
      .populate('createdBy', 'name email')
      .populate('syncFrom', 'name slug');
  }

  /**
   * Get default environment for a project
   */
  async getDefaultEnvironment(projectId: string) {
    return Environment.findOne({ projectId, isDefault: true });
  }

  /**
   * Promote content from one environment to another
   */
  async promoteContent(
    fromEnvironmentId: string,
    toEnvironmentId: string,
    options: PromoteOptions = {}
  ): Promise<SyncResult> {
    const { contentIds, overwrite = false } = options;

    const result: SyncResult = {
      promoted: 0,
      failed: 0,
      errors: [],
    };

    try {
      // Get environments
      const [fromEnv, toEnv] = await Promise.all([
        Environment.findById(fromEnvironmentId),
        Environment.findById(toEnvironmentId),
      ]);

      if (!fromEnv || !toEnv) {
        throw new Error('Environment not found');
      }

      // Get content to promote
      const filter: any = { projectId: fromEnv.projectId };
      if (contentIds && contentIds.length > 0) {
        filter._id = { $in: contentIds };
      }

      const contentToPromote = await Content.find(filter);

      // Promote each content item
      for (const content of contentToPromote) {
        try {
          await this.promoteContentItem(content, toEnv._id.toString(), overwrite);
          result.promoted++;
        } catch (error: any) {
          result.failed++;
          result.errors.push(`${content.name}: ${error.message}`);
        }
      }

      // Update last sync time
      toEnv.lastSyncAt = new Date();
      await toEnv.save();

      console.log(`✅ Promoted ${result.promoted} content items from ${fromEnv.name} to ${toEnv.name}`);
    } catch (error: any) {
      console.error('Error promoting content:', error);
      result.errors.push(error.message);
    }

    return result;
  }

  /**
   * Promote a single content item
   */
  private async promoteContentItem(
    sourceContent: any,
    targetEnvironmentId: string,
    overwrite: boolean
  ) {
    // Check if content already exists in target environment
    const existing = await Content.findOne({
      projectId: sourceContent.projectId,
      environmentId: targetEnvironmentId,
      slug: sourceContent.slug,
    });

    if (existing && !overwrite) {
      throw new Error('Content already exists in target environment');
    }

    const contentData = {
      ...sourceContent.toObject(),
      _id: existing?._id || new Types.ObjectId(),
      environmentId: targetEnvironmentId,
      createdAt: existing?.createdAt || new Date(),
      updatedAt: new Date(),
    };

    delete contentData.__v;

    if (existing) {
      await Content.findByIdAndUpdate(existing._id, contentData);
    } else {
      await Content.create(contentData);
    }
  }

  /**
   * Compare environments
   */
  async compareEnvironments(env1Id: string, env2Id: string) {
    const [env1, env2] = await Promise.all([
      Environment.findById(env1Id),
      Environment.findById(env2Id),
    ]);

    if (!env1 || !env2) {
      throw new Error('Environment not found');
    }

    const [content1, content2] = await Promise.all([
      Content.find({ projectId: env1.projectId, environmentId: env1._id }).select('slug name type status updatedAt'),
      Content.find({ projectId: env2.projectId, environmentId: env2._id }).select('slug name type status updatedAt'),
    ]);

    const content1Map = new Map(content1.map(c => [c.slug, c]));
    const content2Map = new Map(content2.map(c => [c.slug, c]));

    const onlyInEnv1: any[] = [];
    const onlyInEnv2: any[] = [];
    const different: any[] = [];
    const same: any[] = [];

    // Check content in env1
    content1.forEach(c1 => {
      const c2 = content2Map.get(c1.slug);
      if (!c2) {
        onlyInEnv1.push(c1);
      } else if (c1.updatedAt.getTime() !== c2.updatedAt.getTime()) {
        different.push({ env1: c1, env2: c2 });
      } else {
        same.push(c1);
      }
    });

    // Check content only in env2
    content2.forEach(c2 => {
      if (!content1Map.has(c2.slug)) {
        onlyInEnv2.push(c2);
      }
    });

    return {
      env1: { id: env1._id, name: env1.name },
      env2: { id: env2._id, name: env2.name },
      onlyInEnv1,
      onlyInEnv2,
      different,
      same,
      summary: {
        onlyInEnv1: onlyInEnv1.length,
        onlyInEnv2: onlyInEnv2.length,
        different: different.length,
        same: same.length,
      },
    };
  }

  /**
   * Clone environment
   */
  async cloneEnvironment(
    sourceEnvId: string,
    newName: string,
    newSlug: string,
    userId: string
  ) {
    const sourceEnv = await Environment.findById(sourceEnvId);
    if (!sourceEnv) {
      throw new Error('Source environment not found');
    }

    // Create new environment
    const newEnv = await Environment.create({
      projectId: sourceEnv.projectId,
      name: newName,
      slug: newSlug,
      type: 'custom',
      description: `Cloned from ${sourceEnv.name}`,
      config: sourceEnv.config,
      isPublic: sourceEnv.isPublic,
      createdBy: userId,
    });

    // Clone all content
    const sourceContent = await Content.find({
      projectId: sourceEnv.projectId,
      environmentId: sourceEnv._id,
    });

    const clonedContent = sourceContent.map(content => ({
      ...content.toObject(),
      _id: new Types.ObjectId(),
      environmentId: newEnv._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await Content.insertMany(clonedContent);

    console.log(`✅ Cloned environment ${sourceEnv.name} to ${newName} with ${clonedContent.length} content items`);

    return newEnv;
  }

  /**
   * Delete environment
   */
  async deleteEnvironment(environmentId: string) {
    const environment = await Environment.findById(environmentId);
    if (!environment) {
      throw new Error('Environment not found');
    }

    if (environment.isDefault) {
      throw new Error('Cannot delete default environment');
    }

    if (environment.type === 'production') {
      throw new Error('Cannot delete production environment');
    }

    // Delete all content in this environment
    await Content.deleteMany({ environmentId });

    // Delete environment
    await Environment.findByIdAndDelete(environmentId);

    console.log(`✅ Deleted environment ${environment.name}`);
  }

  /**
   * Set default environment
   */
  async setDefaultEnvironment(environmentId: string) {
    const environment = await Environment.findById(environmentId);
    if (!environment) {
      throw new Error('Environment not found');
    }

    environment.isDefault = true;
    await environment.save();

    return environment;
  }
}

export default new EnvironmentService();
