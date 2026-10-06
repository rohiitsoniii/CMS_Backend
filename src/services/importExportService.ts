import { Types } from 'mongoose';
import { Content, ContentType } from '../models/index.js';
import { Parser } from 'json2csv';

interface ImportOptions {
  projectId: Types.ObjectId;
  contentTypeId: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  overwrite?: boolean;
}

interface ExportOptions {
  projectId: Types.ObjectId;
  contentTypeId?: Types.ObjectId;
  format: 'json' | 'csv';
  includeRelationships?: boolean;
}

export class ImportExportService {
  /**
   * Export content to JSON
   */
  static async exportToJSON(options: ExportOptions): Promise<any[]> {
    const query: any = {
      projectId: options.projectId,
      isDeleted: false,
    };

    if (options.contentTypeId) {
      query.contentTypeId = options.contentTypeId;
    }

    const contents = await Content.find(query)
      .populate('contentTypeId', 'name apiId')
      .populate('createdBy', 'firstName lastName email')
      .lean();

    return contents.map((content) => ({
      id: content._id,
      name: content.name,
      slug: content.slug,
      type: content.type,
      contentType: (content.contentTypeId as any)?.apiId,
      status: content.status,
      data: content.data,
      locale: content.locale,
      localizedData: content.localizedData,
      meta: content.meta,
      seo: content.seo,
      relationships: options.includeRelationships ? content.relationships : undefined,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt,
      createdBy: (content.createdBy as any)?.email,
    }));
  }

  /**
   * Export content to CSV
   */
  static async exportToCSV(options: ExportOptions): Promise<string> {
    const data = await this.exportToJSON(options);

    // Flatten nested objects for CSV
    const flatData = data.map((item) => ({
      id: item.id,
      name: item.name,
      slug: item.slug,
      type: item.type,
      contentType: item.contentType,
      status: item.status,
      locale: item.locale,
      ...this.flattenObject(item.data, 'data'),
      ...this.flattenObject(item.meta, 'meta'),
      ...this.flattenObject(item.seo, 'seo'),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      createdBy: item.createdBy,
    }));

    const parser = new Parser();
    return parser.parse(flatData);
  }

  /**
   * Import content from JSON
   */
  static async importFromJSON(
    data: any[],
    options: ImportOptions
  ): Promise<{
    imported: number;
    updated: number;
    failed: number;
    errors: Array<{ row: number; error: string }>;
  }> {
    const results = {
      imported: 0,
      updated: 0,
      failed: 0,
      errors: [] as Array<{ row: number; error: string }>,
    };

    for (let i = 0; i < data.length; i++) {
      try {
        const item = data[i];

        // Check if content exists by slug
        let existing = null;
        if (item.slug) {
          existing = await Content.findOne({
            projectId: options.projectId,
            slug: item.slug,
            isDeleted: false,
          });
        }

        if (existing && options.overwrite) {
          // Update existing
          existing.name = item.name || existing.name;
          existing.data = item.data || existing.data;
          existing.status = item.status || existing.status;
          existing.meta = { ...existing.meta, ...item.meta };
          existing.seo = { ...existing.seo, ...item.seo };
          existing.updatedBy = options.userId;

          await existing.save();
          results.updated++;
        } else if (!existing) {
          // Create new
          await Content.create({
            projectId: options.projectId,
            contentTypeId: options.contentTypeId,
            tenantId: options.tenantId,
            name: item.name,
            slug: item.slug,
            type: item.type || 'custom',
            data: item.data || {},
            status: item.status || 'draft',
            locale: item.locale || 'en',
            localizedData: item.localizedData,
            meta: item.meta || {},
            seo: item.seo || {},
            relationships: item.relationships,
            createdBy: options.userId,
          });
          results.imported++;
        } else {
          // Skip (exists and no overwrite)
          results.failed++;
          results.errors.push({
            row: i + 1,
            error: 'Content already exists (use overwrite option)',
          });
        }
      } catch (error: any) {
        results.failed++;
        results.errors.push({
          row: i + 1,
          error: error.message || 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Import content from CSV
   */
  static async importFromCSV(
    csvData: string,
    options: ImportOptions
  ): Promise<{
    imported: number;
    updated: number;
    failed: number;
    errors: Array<{ row: number; error: string }>;
  }> {
    // Parse CSV to JSON
    const lines = csvData.split('\n');
    const headers = lines[0].split(',').map((h) => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;

      const values = lines[i].split(',').map((v) => v.trim());
      const obj: any = {};

      headers.forEach((header, index) => {
        obj[header] = values[index];
      });

      // Reconstruct nested objects
      const item = {
        name: obj.name,
        slug: obj.slug,
        type: obj.type,
        status: obj.status,
        locale: obj.locale,
        data: this.unflattenObject(obj, 'data'),
        meta: this.unflattenObject(obj, 'meta'),
        seo: this.unflattenObject(obj, 'seo'),
      };

      data.push(item);
    }

    return this.importFromJSON(data, options);
  }

  /**
   * Validate import data
   */
  static validateImportData(data: any[]): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!Array.isArray(data)) {
      errors.push('Data must be an array');
      return { valid: false, errors };
    }

    if (data.length === 0) {
      errors.push('Data array is empty');
      return { valid: false, errors };
    }

    data.forEach((item, index) => {
      if (!item.name) {
        errors.push(`Row ${index + 1}: Missing required field 'name'`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Helper: Flatten nested object for CSV
   */
  private static flattenObject(obj: any, prefix: string): any {
    if (!obj || typeof obj !== 'object') return {};

    const flattened: any = {};
    Object.keys(obj).forEach((key) => {
      const value = obj[key];
      if (typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(flattened, this.flattenObject(value, `${prefix}.${key}`));
      } else {
        flattened[`${prefix}.${key}`] = Array.isArray(value)
          ? JSON.stringify(value)
          : value;
      }
    });

    return flattened;
  }

  /**
   * Helper: Unflatten object from CSV
   */
  private static unflattenObject(obj: any, prefix: string): any {
    const result: any = {};

    Object.keys(obj).forEach((key) => {
      if (key.startsWith(`${prefix}.`)) {
        const subKey = key.substring(prefix.length + 1);
        let value = obj[key];

        // Try to parse JSON arrays
        if (typeof value === 'string' && value.startsWith('[')) {
          try {
            value = JSON.parse(value);
          } catch (e) {
            // Keep as string
          }
        }

        result[subKey] = value;
      }
    });

    return result;
  }
}
