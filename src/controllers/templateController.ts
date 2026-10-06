import { Request, Response } from 'express';
import { TemplateService } from '../services/templateService';

export const templateController = {
  /**
   * Get all available templates
   */
  async getTemplates(req: Request, res: Response) {
    try {
      const templates = TemplateService.getTemplates();
      res.json(templates);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  /**
   * Apply a template to a project
   */
  async applyTemplate(req: Request, res: Response) {
    try {
      const { templateId } = req.body;
      const { projectId } = req.params;
      const tenantId = req.user!.tenantId;
      const userId = req.user!.id;

      if (!templateId) {
        return res.status(400).json({ error: 'Template ID is required' });
      }

      const results = await TemplateService.applyTemplate(
        String(tenantId),
        projectId,
        templateId,
        String(userId)
      );

      res.json({
        message: 'Template applied successfully',
        contentTypesCreated: results.length
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
};
