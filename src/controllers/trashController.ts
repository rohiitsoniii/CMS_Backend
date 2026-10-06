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

      res.json(trashItem);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get trash items
  async getTrashItems(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const filters = req.query;

      const items = await TrashService.getTrashItems(projectId, filters);
      res.json(items);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Restore from trash
  async restore(req: Request, res: Response) {
    try {
      const { trashId } = req.params;
      const restored = await TrashService.restoreFromTrash(trashId);
      res.json(restored);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Permanent delete
  async permanentDelete(req: Request, res: Response) {
    try {
      const { trashId } = req.params;
      await TrashService.permanentDelete(trashId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Bulk restore
  async bulkRestore(req: Request, res: Response) {
    try {
      const { trashIds } = req.body;
      const results = await TrashService.bulkRestore(trashIds);
      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Empty trash
  async emptyTrash(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      await TrashService.emptyTrash(projectId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
};
