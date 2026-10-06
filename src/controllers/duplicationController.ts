import { Request, Response } from 'express';
import { DuplicationService } from '../services/duplicationService';

export const duplicationController = {
  // Duplicate content
  async duplicate(req: Request, res: Response) {
    try {
      const { contentId } = req.params;
      const options = req.body;

      const duplicated = await DuplicationService.duplicateContent(contentId, options);
      res.json(duplicated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Bulk duplicate
  async bulkDuplicate(req: Request, res: Response) {
    try {
      const { contentIds, options } = req.body;
      const results = await DuplicationService.bulkDuplicate(contentIds, options);
      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Create template
  async createTemplate(req: Request, res: Response) {
    try {
      const { contentId } = req.params;
      const { templateName } = req.body;

      const template = await DuplicationService.createTemplate(contentId, templateName);
      res.json(template);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Clone to project
  async cloneToProject(req: Request, res: Response) {
    try {
      const { contentId } = req.params;
      const { targetProjectId } = req.body;

      const cloned = await DuplicationService.cloneToProject(contentId, targetProjectId);
      res.json(cloned);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Deep clone
  async deepClone(req: Request, res: Response) {
    try {
      const { contentId } = req.params;
      const cloned = await DuplicationService.deepClone(contentId);
      res.json(cloned);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
};
