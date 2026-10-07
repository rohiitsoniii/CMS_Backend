/**
 * References Service
 * 
 * Tracks and manages content references and backlinks
 */

import { Content } from '../models/Content';
import { Types } from 'mongoose';

interface Reference {
  fromContentId: string;
  fromContentName: string;
  fromContentType: string;
  fieldName: string;
  toContentId: string;
}

interface Backlink {
  contentId: string;
  contentName: string;
  contentType: string;
  fieldName: string;
}

class ReferencesService {
  /**
   * Get all references from a content item
   */
  async getReferences(contentId: string): Promise<Reference[]> {
    try {
      const content = await Content.findById(contentId);
      if (!content) return [];

      const references: Reference[] = [];

      // Check relationships field
      if (content.relationships) {
        for (const [fieldName, value] of Object.entries(content.relationships)) {
          const ids = Array.isArray(value) ? value : [value];
          
          for (const refId of ids) {
            const referencedContent = await Content.findById(refId);
            if (referencedContent) {
              references.push({
                fromContentId: content._id.toString(),
                fromContentName: content.name,
                fromContentType: content.type,
                fieldName,
                toContentId: referencedContent._id.toString(),
              });
            }
          }
        }
      }

      // Check data field for references
      if (content.data) {
        await this.findReferencesInData(
          content.data,
          content._id.toString(),
          content.name,
          content.type,
          references
        );
      }

      return references;
    } catch (error) {
      console.error('Error getting references:', error);
      return [];
    }
  }

  /**
   * Get all backlinks to a content item (who references this content)
   */
  async getBacklinks(contentId: string): Promise<Backlink[]> {
    try {
      const backlinks: Backlink[] = [];

      // Find content that references this content in relationships
      const contentsWithRelationships = await Content.find({
        [`relationships`]: { $exists: true },
      });

      for (const content of contentsWithRelationships) {
        if (!content.relationships) continue;

        for (const [fieldName, value] of Object.entries(content.relationships)) {
          const ids = Array.isArray(value) ? value : [value];
          
          if (ids.some((id: any) => id.toString() === contentId)) {
            backlinks.push({
              contentId: content._id.toString(),
              contentName: content.name,
              contentType: content.type,
              fieldName,
            });
          }
        }
      }

      // Find content that references this content in data field
      const contentsWithData = await Content.find({
        data: { $exists: true },
      });

      for (const content of contentsWithData) {
        if (!content.data) continue;

        const hasReference = await this.checkDataForReference(
          content.data,
          contentId
        );

        if (hasReference) {
          backlinks.push({
            contentId: content._id.toString(),
            contentName: content.name,
            contentType: content.type,
            fieldName: 'data',
          });
        }
      }

      return backlinks;
    } catch (error) {
      console.error('Error getting backlinks:', error);
      return [];
    }
  }

  /**
   * Check if content can be safely deleted
   */
  async canDelete(contentId: string): Promise<{
    canDelete: boolean;
    backlinks: Backlink[];
    message?: string;
  }> {
    const backlinks = await this.getBacklinks(contentId);

    if (backlinks.length === 0) {
      return {
        canDelete: true,
        backlinks: [],
      };
    }

    return {
      canDelete: false,
      backlinks,
      message: `Cannot delete: This content is referenced by ${backlinks.length} other content item(s)`,
    };
  }

  /**
   * Get reference graph for a content item
   */
  async getReferenceGraph(contentId: string, depth: number = 2): Promise<any> {
    const visited = new Set<string>();
    
    const buildGraph = async (id: string, currentDepth: number): Promise<any> => {
      if (currentDepth > depth || visited.has(id)) {
        return null;
      }

      visited.add(id);

      const content = await Content.findById(id);
      if (!content) return null;

      const references = await this.getReferences(id);
      const backlinks = await this.getBacklinks(id);

      const children = await Promise.all(
        references.map(ref => buildGraph(ref.toContentId, currentDepth + 1))
      );

      return {
        id: content._id.toString(),
        name: content.name,
        type: content.type,
        status: content.status,
        references: references.length,
        backlinks: backlinks.length,
        children: children.filter(Boolean),
      };
    };

    return buildGraph(contentId, 0);
  }

  /**
   * Update references when content is updated
   */
  async updateReferences(contentId: string, newRelationships: any) {
    try {
      const content = await Content.findById(contentId);
      if (!content) return;

      // Update relationships field
      content.relationships = newRelationships;
      await content.save();

      console.log(`✅ Updated references for ${content.name}`);
    } catch (error) {
      console.error('Error updating references:', error);
    }
  }

  /**
   * Validate references (check if all referenced content exists)
   */
  async validateReferences(contentId: string): Promise<{
    valid: boolean;
    brokenReferences: Array<{
      fieldName: string;
      missingId: string;
    }>;
  }> {
    try {
      const content = await Content.findById(contentId);
      if (!content) {
        return { valid: false, brokenReferences: [] };
      }

      const brokenReferences: Array<{ fieldName: string; missingId: string }> = [];

      if (content.relationships) {
        for (const [fieldName, value] of Object.entries(content.relationships)) {
          const ids = Array.isArray(value) ? value : [value];
          
          for (const refId of ids) {
            const exists = await Content.exists({ _id: refId });
            if (!exists) {
              brokenReferences.push({
                fieldName,
                missingId: refId.toString(),
              });
            }
          }
        }
      }

      return {
        valid: brokenReferences.length === 0,
        brokenReferences,
      };
    } catch (error) {
      console.error('Error validating references:', error);
      return { valid: false, brokenReferences: [] };
    }
  }

  /**
   * Fix broken references by removing them
   */
  async fixBrokenReferences(contentId: string): Promise<number> {
    try {
      const content = await Content.findById(contentId);
      if (!content || !content.relationships) return 0;

      let fixed = 0;

      for (const [fieldName, value] of Object.entries(content.relationships)) {
        const ids = Array.isArray(value) ? value : [value];
        const validIds: Types.ObjectId[] = [];

        for (const refId of ids) {
          const exists = await Content.exists({ _id: refId });
          if (exists) {
            validIds.push(refId as Types.ObjectId);
          } else {
            fixed++;
          }
        }

        if (Array.isArray(value)) {
          content.relationships[fieldName] = validIds;
        } else if (validIds.length > 0) {
          content.relationships[fieldName] = validIds[0];
        } else {
          delete content.relationships[fieldName];
        }
      }

      if (fixed > 0) {
        await content.save();
        console.log(`✅ Fixed ${fixed} broken references in ${content.name}`);
      }

      return fixed;
    } catch (error) {
      console.error('Error fixing broken references:', error);
      return 0;
    }
  }

  /**
   * Helper: Find references in data object recursively
   */
  private async findReferencesInData(
    data: any,
    fromId: string,
    fromName: string,
    fromType: string,
    references: Reference[],
    path: string = ''
  ): Promise<void> {
    if (!data || typeof data !== 'object') return;

    for (const [key, value] of Object.entries(data)) {
      const currentPath = path ? `${path}.${key}` : key;

      // Check if value is an ObjectId
      if (Types.ObjectId.isValid(value as any)) {
        const referencedContent = await Content.findById(value);
        if (referencedContent) {
          references.push({
            fromContentId: fromId,
            fromContentName: fromName,
            fromContentType: fromType,
            fieldName: currentPath,
            toContentId: referencedContent._id.toString(),
          });
        }
      }

      // Recurse into nested objects/arrays
      if (typeof value === 'object' && value !== null) {
        await this.findReferencesInData(
          value,
          fromId,
          fromName,
          fromType,
          references,
          currentPath
        );
      }
    }
  }

  /**
   * Helper: Check if data contains a reference to contentId
   */
  private async checkDataForReference(data: any, contentId: string): Promise<boolean> {
    if (!data || typeof data !== 'object') return false;

    for (const value of Object.values(data) as any[]) {
      // Check if value is the contentId
      if (Types.ObjectId.isValid(value as any) && value.toString() === contentId) {
        return true;
      }

      // Recurse into nested objects/arrays
      if (typeof value === 'object' && value !== null) {
        const found = await this.checkDataForReference(value, contentId);
        if (found) return true;
      }
    }

    return false;
  }

  /**
   * Get usage statistics for content
   */
  async getUsageStats(contentId: string): Promise<{
    referencesCount: number;
    backlinksCount: number;
    isUsed: boolean;
    usedIn: string[];
  }> {
    const [references, backlinks] = await Promise.all([
      this.getReferences(contentId),
      this.getBacklinks(contentId),
    ]);

    const usedIn = [...new Set(backlinks.map(b => b.contentType))];

    return {
      referencesCount: references.length,
      backlinksCount: backlinks.length,
      isUsed: backlinks.length > 0,
      usedIn,
    };
  }
}

export default new ReferencesService();
