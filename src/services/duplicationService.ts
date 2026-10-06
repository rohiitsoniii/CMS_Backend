import { Content } from '../models/Content';
import { MediaFile } from '../models/MediaFile';
import mongoose from 'mongoose';

export class DuplicationService {
  // Duplicate single content item
  static async duplicateContent(
    contentId: string,
    options: {
      includeRelationships?: boolean;
      includeTranslations?: boolean;
      newTitle?: string;
      targetProjectId?: string;
    } = {}
  ) {
    const original = await Content.findById(contentId);
    
    if (!original) {
      throw new Error('Content not found');
    }

    const duplicate: any = {
      ...original.toObject(),
      _id: new mongoose.Types.ObjectId(),
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    delete duplicate.__v;

    // Update title
    if (options.newTitle) {
      duplicate.data.title = options.newTitle;
    } else if (duplicate.data.title) {
      duplicate.data.title = `${duplicate.data.title} (Copy)`;
    }

    // Change project if specified
    if (options.targetProjectId) {
      duplicate.projectId = options.targetProjectId;
    }

    // Handle relationships
    if (!options.includeRelationships) {
      // Clear relationship fields
      const relationshipFields = Object.keys(duplicate.data).filter(key => 
        Array.isArray(duplicate.data[key]) && 
        duplicate.data[key].some((item: any) => mongoose.Types.ObjectId.isValid(item))
      );
      
      relationshipFields.forEach(field => {
        duplicate.data[field] = [];
      });
    }

    // Handle translations
    if (!options.includeTranslations) {
      duplicate.translations = {};
    }

    const created = await Content.create(duplicate);
    return created;
  }

  // Bulk duplicate
  static async bulkDuplicate(contentIds: string[], options: any = {}) {
    const results = [];
    
    for (const id of contentIds) {
      try {
        const duplicated = await this.duplicateContent(id, options);
        results.push({ id, success: true, duplicated });
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  // Create template from content
  static async createTemplate(contentId: string, templateName: string) {
    const content = await Content.findById(contentId);
    
    if (!content) {
      throw new Error('Content not found');
    }

    const template = {
      name: templateName,
      contentTypeId: content.contentTypeId,
      data: content.data,
      metadata: {
        createdFrom: contentId,
        createdAt: new Date()
      }
    };

    // Store template (you can create a Template model or store in project settings)
    return template;
  }

  // Clone across projects
  static async cloneToProject(contentId: string, targetProjectId: string) {
    return this.duplicateContent(contentId, {
      targetProjectId,
      includeRelationships: false,
      includeTranslations: true
    });
  }

  // Duplicate with all relationships (deep clone)
  static async deepClone(contentId: string) {
    const original = await Content.findById(contentId);
    
    if (!original) {
      throw new Error('Content not found');
    }

    // First duplicate the main content
    const mainDuplicate = await this.duplicateContent(contentId, {
      includeRelationships: true,
      includeTranslations: true
    });

    // Find and duplicate related content
    const relationshipFields = Object.keys(original.data).filter(key => 
      Array.isArray(original.data[key]) && 
      original.data[key].some((item: any) => mongoose.Types.ObjectId.isValid(item))
    );

    const newRelationships: any = {};

    for (const field of relationshipFields) {
      const relatedIds = original.data[field];
      const duplicatedRelated = [];

      for (const relatedId of relatedIds) {
        try {
          const dup = await this.duplicateContent(relatedId, {
            includeRelationships: false
          });
          duplicatedRelated.push(dup._id);
        } catch (error) {
          // Skip if related content not found
        }
      }

      newRelationships[field] = duplicatedRelated;
    }

    // Update main duplicate with new relationship IDs
    await Content.findByIdAndUpdate(mainDuplicate._id, {
      $set: { [`data`]: { ...mainDuplicate.data, ...newRelationships } }
    });

    return mainDuplicate;
  }
}
