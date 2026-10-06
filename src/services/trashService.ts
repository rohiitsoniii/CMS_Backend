import { Trash } from '../models/Trash';
import { Content } from '../models/Content';
import { MediaFile } from '../models/MediaFile';
import { ContentType } from '../models/ContentType';
import mongoose from 'mongoose';

export class TrashService {
  // Move item to trash (soft delete)
  static async moveToTrash(
    projectId: string,
    itemType: 'content' | 'media' | 'contentType',
    itemId: string,
    userId: string,
    metadata?: any
  ) {
    let itemData;
    
    switch (itemType) {
      case 'content':
        itemData = await Content.findById(itemId);
        break;
      case 'media':
        itemData = await MediaFile.findById(itemId);
        break;
      case 'contentType':
        itemData = await ContentType.findById(itemId);
        break;
    }

    if (!itemData) {
      throw new Error('Item not found');
    }

    const trashItem = await Trash.create({
      projectId,
      itemType,
      itemId,
      itemData: itemData.toObject(),
      deletedBy: userId,
      metadata
    });

    // Mark original as deleted
    await itemData.deleteOne();

    return trashItem;
  }

  // Restore from trash
  static async restoreFromTrash(trashId: string) {
    const trashItem = await Trash.findById(trashId);
    
    if (!trashItem) {
      throw new Error('Trash item not found');
    }

    let restored;
    
    switch (trashItem.itemType) {
      case 'content':
        restored = await Content.create(trashItem.itemData);
        break;
      case 'media':
        restored = await MediaFile.create(trashItem.itemData);
        break;
      case 'contentType':
        restored = await ContentType.create(trashItem.itemData);
        break;
    }

    await Trash.findByIdAndDelete(trashId);

    return restored;
  }

  // Get trash items
  static async getTrashItems(projectId: string, filters?: any) {
    const query: any = { projectId };
    
    if (filters?.itemType) {
      query.itemType = filters.itemType;
    }

    return Trash.find(query)
      .populate('deletedBy', 'name email')
      .sort({ deletedAt: -1 });
  }

  // Permanently delete
  static async permanentDelete(trashId: string) {
    return Trash.findByIdAndDelete(trashId);
  }

  // Bulk restore
  static async bulkRestore(trashIds: string[]) {
    const results = [];
    
    for (const id of trashIds) {
      try {
        const restored = await this.restoreFromTrash(id);
        results.push({ id, success: true, restored });
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  // Auto-purge expired items (run as cron job)
  static async autoPurge() {
    const expiredItems = await Trash.find({
      purgeAt: { $lte: new Date() }
    });

    const deleted = await Trash.deleteMany({
      purgeAt: { $lte: new Date() }
    });

    return { count: deleted.deletedCount, items: expiredItems };
  }

  // Empty trash for project
  static async emptyTrash(projectId: string) {
    return Trash.deleteMany({ projectId });
  }
}
