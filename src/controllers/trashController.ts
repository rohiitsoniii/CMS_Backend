import { Request, Response } from 'express';
import { TrashService } from '../services/trashService';

export const trashController = {
  // Move to trash
  async moveToTrash(req: Request, res: Response) {
    try {
      const { itemType, itemId, metadata } = req.body;
      const { projectId } = req.params;
      const userId = req.user!.id;

      const trashItem = await TrashService.moveToTrash(
        projectId,
        itemType,
        itemId,
        userId,
        metadata
      );

      return res.json(trashItem);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Get trash items
  async getTrashItems(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const filters = req.query;

      const items = await TrashService.getTrashItems(projectId, filters);
      return res.json(items);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Restore from trash
  async restore(req: Request, res: Response) {
    try {
      const { trashId } = req.params;
      const restored = await TrashService.restoreFromTrash(trashId);
      return res.json(restored);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Permanent delete
  async permanentDelete(req: Request, res: Response) {
    try {
      const { trashId } = req.params;
      await TrashService.permanentDelete(trashId);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Bulk restore
  async bulkRestore(req: Request, res: Response) {
    try {
      const { trashIds } = req.body;
      const results = await TrashService.bulkRestore(trashIds);
      return res.json(results);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Empty trash
  async emptyTrash(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      await TrashService.emptyTrash(projectId);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }
};
