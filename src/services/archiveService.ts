import { Archive } from '../models/Archive';
import { Content } from '../models/Content';
import { ContentType } from '../models/ContentType';

export class ArchiveService {
  // Archive content
  static async archiveContent(contentId: string, userId: string, reason?: string) {
    const content = await Content.findById(contentId);
    
    if (!content) {
      throw new Error('Content not found');
    }

    const contentType = await ContentType.findById(content.contentTypeId);

    const archived = await Archive.create({
      projectId: content.projectId,
      contentId: content._id,
      contentData: content.toObject(),
      archivedBy: userId,
      reason,
      metadata: {
        contentTypeName: contentType?.name || 'Unknown',
        title: content.data?.title,
        originalPublishedAt: content.publishedAt
      }
    });

    // Optionally delete the original content
    await Content.findByIdAndDelete(contentId);

    return archived;
  }

  // Restore from archive
  static async restoreFromArchive(archiveId: string) {
    const archived = await Archive.findById(archiveId);
    
    if (!archived) {
      throw new Error('Archive not found');
    }

    const restored = await Content.create(archived.contentData);

    // Optionally delete the archive entry
    await Archive.findByIdAndDelete(archiveId);

    return restored;
  }

  // Get archived items
  static async getArchivedItems(projectId: string, filters?: any) {
    const query: any = { projectId };
    
    if (filters?.contentTypeName) {
      query['metadata.contentTypeName'] = filters.contentTypeName;
    }

    if (filters?.dateFrom) {
      query.archivedAt = { $gte: new Date(filters.dateFrom) };
    }

    if (filters?.dateTo) {
      query.archivedAt = { ...query.archivedAt, $lte: new Date(filters.dateTo) };
    }

    return Archive.find(query)
      .populate('archivedBy', 'name email')
      .sort({ archivedAt: -1 });
  }

  // Bulk archive
  static async bulkArchive(contentIds: string[], userId: string, reason?: string) {
    const results = [];
    
    for (const id of contentIds) {
      try {
        const archived = await this.archiveContent(id, userId, reason);
        results.push({ id, success: true, archived });
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  // Permanently delete archived item
  static async permanentDelete(archiveId: string) {
    return Archive.findByIdAndDelete(archiveId);
  }

  // Get archive statistics
  static async getArchiveStats(projectId: string) {
    const total = await Archive.countDocuments({ projectId });
    
    const byContentType = await Archive.aggregate([
      { $match: { projectId } },
      { $group: { _id: '$metadata.contentTypeName', count: { $sum: 1 } } }
    ]);

    const byMonth = await Archive.aggregate([
      { $match: { projectId } },
      {
        $group: {
          _id: {
            year: { $year: '$archivedAt' },
            month: { $month: '$archivedAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } }
    ]);

    return {
      total,
      byContentType,
      byMonth
    };
  }
}
