import { Request, Response } from 'express';
import { BulkOperationsService } from '../services/bulkOperationsService';

export const bulkOperationsController = {
  // Bulk publish
  async bulkPublish(req: Request, res: Response) {
    try {
      const { contentIds } = req.body;
      const userId = req.user!.id;

      const results = await BulkOperationsService.bulkPublish(contentIds, userId);
      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Bulk unpublish
  async bulkUnpublish(req: Request, res: Response) {
    try {
      const { contentIds } = req.body;
      const userId = req.user!.id;

      const results = await BulkOperationsService.bulkUnpublish(contentIds, userId);
      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Bulk delete
  async bulkDelete(req: Request, res: Response) {
    try {
      const { contentIds } = req.body;
      const { projectId } = req.params;
      const userId = req.user!.id;

      const results = await BulkOperationsService.bulkDelete(contentIds, projectId, userId);
      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Bulk add tags
  async bulkAddTags(req: Request, res: Response) {
    try {
      const { contentIds, tags } = req.body;
      const results = await BulkOperationsService.bulkAddTags(contentIds, tags);
      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Bulk remove tags
  async bulkRemoveTags(req: Request, res: Response) {
    try {
      const { contentIds, tags } = req.body;
      const results = await BulkOperationsService.bulkRemoveTags(contentIds, tags);
      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Bulk update field
  async bulkUpdateField(req: Request, res: Response) {
    try {
      const { contentIds, fieldPath, value } = req.body;
      const results = await BulkOperationsService.bulkUpdateField(contentIds, fieldPath, value);
      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Bulk schedule
  async bulkSchedule(req: Request, res: Response) {
    try {
      const { contentIds, publishAt, unpublishAt } = req.body;
      const results = await BulkOperationsService.bulkSchedule(
        contentIds,
        new Date(publishAt),
        unpublishAt ? new Date(unpublishAt) : undefined
      );
      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Bulk move to folder
  async bulkMoveToFolder(req: Request, res: Response) {
    try {
      const { fileIds, folderId } = req.body;
      const results = await BulkOperationsService.bulkMoveToFolder(fileIds, folderId);
      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
};
