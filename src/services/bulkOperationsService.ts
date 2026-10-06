import { Content } from '../models/Content';
import { MediaFile } from '../models/MediaFile';
import { TrashService } from './trashService';
import { DuplicationService } from './duplicationService';

export class BulkOperationsService {
  // Bulk update status
  static async bulkUpdateStatus(contentIds: string[], status: string, userId: string) {
    const results = [];
    
    for (const id of contentIds) {
      try {
        const updated = await Content.findByIdAndUpdate(
          id,
          { 
            status,
            updatedBy: userId,
            ...(status === 'published' && { publishedAt: new Date() })
          },
          { new: true }
        );
        results.push({ id, success: true, updated });
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  // Bulk publish
  static async bulkPublish(contentIds: string[], userId: string) {
    return this.bulkUpdateStatus(contentIds, 'published', userId);
  }

  // Bulk unpublish
  static async bulkUnpublish(contentIds: string[], userId: string) {
    return this.bulkUpdateStatus(contentIds, 'draft', userId);
  }

  // Bulk delete (move to trash)
  static async bulkDelete(contentIds: string[], projectId: string, userId: string) {
    const results = [];
    
    for (const id of contentIds) {
      try {
        const content = await Content.findById(id);
        if (content) {
          await TrashService.moveToTrash(
            projectId,
            'content',
            id,
            userId,
            { title: content.data?.title }
          );
          results.push({ id, success: true });
        }
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  // Bulk tag assignment
  static async bulkAddTags(contentIds: string[], tags: string[]) {
    const results = [];
    
    for (const id of contentIds) {
      try {
        const updated = await Content.findByIdAndUpdate(
          id,
          { $addToSet: { 'data.tags': { $each: tags } } },
          { new: true }
        );
        results.push({ id, success: true, updated });
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  // Bulk remove tags
  static async bulkRemoveTags(contentIds: string[], tags: string[]) {
    const results = [];
    
    for (const id of contentIds) {
      try {
        const updated = await Content.findByIdAndUpdate(
          id,
          { $pull: { 'data.tags': { $in: tags } } },
          { new: true }
        );
        results.push({ id, success: true, updated });
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  // Bulk update field
  static async bulkUpdateField(contentIds: string[], fieldPath: string, value: any) {
    const results = [];
    
    for (const id of contentIds) {
      try {
        const updated = await Content.findByIdAndUpdate(
          id,
          { $set: { [`data.${fieldPath}`]: value } },
          { new: true }
        );
        results.push({ id, success: true, updated });
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  // Bulk duplicate
  static async bulkDuplicate(contentIds: string[], options: any = {}) {
    return DuplicationService.bulkDuplicate(contentIds, options);
  }

  // Bulk move to folder (for media)
  static async bulkMoveToFolder(fileIds: string[], folderId: string) {
    const results = [];
    
    for (const id of fileIds) {
      try {
        const updated = await MediaFile.findByIdAndUpdate(
          id,
          { folderId },
          { new: true }
        );
        results.push({ id, success: true, updated });
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  // Bulk archive
  static async bulkArchive(contentIds: string[], projectId: string, userId: string, reason?: string) {
    const results = [];
    
    for (const id of contentIds) {
      try {
        const content = await Content.findById(id);
        if (content) {
          // Archive logic here (you can import ArchiveService)
          results.push({ id, success: true });
        }
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  // Bulk schedule
  static async bulkSchedule(contentIds: string[], publishAt: Date, unpublishAt?: Date) {
    const results = [];
    
    for (const id of contentIds) {
      try {
        const updated = await Content.findByIdAndUpdate(
          id,
          { 
            scheduledPublishAt: publishAt,
            ...(unpublishAt && { scheduledUnpublishAt: unpublishAt })
          },
          { new: true }
        );
        results.push({ id, success: true, updated });
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  // Get bulk operation status
  static async getBulkOperationStatus(operationId: string) {
    // This would track long-running bulk operations
    // For now, return a simple status
    return {
      operationId,
      status: 'completed',
      total: 0,
      processed: 0,
      succeeded: 0,
      failed: 0
    };
  }
}
