import mongoose from 'mongoose';
import { EnvVariable } from '../models/EnvVariable.js';

export class EnvVariableService {
  static async createVariable(
    data: {
      tenantId: string;
      projectId?: string;
      key: string;
      value: string;
      isSecret?: boolean;
      description?: string;
      category?: string;
      environment?: string;
    },
    userId: string
  ): Promise<any> {
    const existing = await EnvVariable.findOne({
      tenantId: new mongoose.Types.ObjectId(data.tenantId),
      key: data.key
    });

    if (existing) {
      throw new Error(`Variable with key "${data.key}" already exists`);
    }

    return EnvVariable.create({
      ...data,
      tenantId: new mongoose.Types.ObjectId(data.tenantId),
      projectId: data.projectId ? new mongoose.Types.ObjectId(data.projectId) : undefined,
      createdBy: new mongoose.Types.ObjectId(userId),
      isSecret: data.isSecret ?? false,
      category: data.category ?? 'custom',
      environment: data.environment ?? 'all'
    });
  }

  static async updateVariable(
    variableId: string,
    tenantId: string,
    updates: {
      value?: string;
      description?: string;
      category?: string;
      environment?: string;
    }
  ): Promise<any> {
    return EnvVariable.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(variableId),
        tenantId: new mongoose.Types.ObjectId(tenantId)
      },
      { $set: updates },
      { new: true }
    );
  }

  static async deleteVariable(variableId: string, tenantId: string): Promise<boolean> {
    const result = await EnvVariable.deleteOne({
      _id: new mongoose.Types.ObjectId(variableId),
      tenantId: new mongoose.Types.ObjectId(tenantId)
    });
    return result.deletedCount > 0;
  }

  static async getVariables(
    tenantId: string,
    options: {
      projectId?: string;
      category?: string;
      environment?: string;
      includeSecrets?: boolean;
    } = {}
  ): Promise<any[]> {
    const query: any = {
      tenantId: new mongoose.Types.ObjectId(tenantId)
    };

    if (options.projectId) {
      query.$or = [
        { projectId: new mongoose.Types.ObjectId(options.projectId) },
        { projectId: null }
      ];
    }

    if (options.category) {
      query.category = options.category;
    }

    if (options.environment && options.environment !== 'all') {
      query.$or = [
        { environment: 'all' },
        { environment: options.environment }
      ];
    }

    const variables = await EnvVariable.find(query).sort({ category: 1, key: 1 });

    if (!options.includeSecrets) {
      return variables.map(v => ({
        ...v.toObject(),
        value: v.isSecret ? '••••••••' : v.value
      }));
    }

    return variables;
  }

  static async getVariableById(variableId: string, tenantId: string): Promise<any | null> {
    return EnvVariable.findOne({
      _id: new mongoose.Types.ObjectId(variableId),
      tenantId: new mongoose.Types.ObjectId(tenantId)
    });
  }

  static async getVariablesForProject(
    projectId: string,
    environment: string = 'all'
  ): Promise<Record<string, string>> {
    const variables = await EnvVariable.find({
      $or: [
        { projectId: new mongoose.Types.ObjectId(projectId), environment: { $in: [environment, 'all'] } },
        { projectId: null, environment: { $in: [environment, 'all'] } }
      ]
    }).select('key value isSecret');

    const envObj: Record<string, string> = {};
    variables.forEach(v => {
      envObj[v.key] = v.value;
    });

    return envObj;
  }

  static async bulkCreateVariables(
    tenantId: string,
    variables: Array<{
      key: string;
      value: string;
      isSecret?: boolean;
      category?: string;
    }>,
    userId: string
  ): Promise<any> {
    const ops = variables.map(v => ({
      insertOne: {
        document: {
          tenantId: new mongoose.Types.ObjectId(tenantId),
          key: v.key,
          value: v.value,
          isSecret: v.isSecret ?? false,
          category: v.category ?? 'custom',
          environment: 'all',
          createdBy: new mongoose.Types.ObjectId(userId)
        }
      }
    }));

    const result = await EnvVariable.bulkWrite(ops as any);
    return result;
  }

  static async exportVariables(
    tenantId: string,
    options: { includeSecrets?: boolean } = {}
  ): Promise<string> {
    const variables = await this.getVariables(tenantId, {
      includeSecrets: options.includeSecrets
    });

    const envContent = variables
      .map(v => {
        const comment = v.description ? `# ${v.description}\n` : '';
        return `${comment}${v.key}=${v.value}`;
      })
      .join('\n\n');

    return `# Environment Variables\n# Generated on ${new Date().toISOString()}\n\n${envContent}`;
  }
}