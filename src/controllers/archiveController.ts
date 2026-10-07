import { Request, Response } from 'express';
import { ArchiveService } from '../services/archiveService';

export const archiveController = {
  // Archive content
  async archive(req: Request, res: Response) {
    try {
      const { contentId } = req.params;
      const { reason } = req.body;
      const userId = req.user!.id;

      const archived = await ArchiveService.archiveContent(contentId, userId, reason);
      return res.json(archived);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Restore from archive
  async restore(req: Request, res: Response) {
    try {
      const { archiveId } = req.params;
      const restored = await ArchiveService.restoreFromArchive(archiveId);
      return res.json(restored);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Get archived items
  async getArchived(req: Request, res: Response) {
    try {
      const projectId = req.params.projectId || (req.query.projectId as string);
      const filters = req.query;

      const items = await ArchiveService.getArchivedItems(projectId, filters);
      return res.json({ success: true, data: items });
    } catch (error: any) {
      return res.status(400).json({ success: false, error: error.message });
    }
  },

  // Bulk archive
  async bulkArchive(req: Request, res: Response) {
    try {
      const { contentIds, reason } = req.body;
      const userId = req.user!.id;

      const results = await ArchiveService.bulkArchive(contentIds, userId, reason);
      return res.json(results);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Permanent delete
  async permanentDelete(req: Request, res: Response) {
    try {
      const { archiveId } = req.params;
      await ArchiveService.permanentDelete(archiveId);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Get archive stats
  async getStats(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const stats = await ArchiveService.getArchiveStats(projectId);
      return res.json(stats);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }
};
