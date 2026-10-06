import { Request, Response } from 'express';
import { ValidationService } from '../services/validationService';

export const validationController = {
  // Validate content
  async validateContent(req: Request, res: Response) {
    try {
      const { contentTypeId } = req.params;
      const { data } = req.body;

      const result = await ValidationService.validateContent(contentTypeId, data);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Create validation rule
  async createRule(req: Request, res: Response) {
    try {
      const rule = await ValidationService.createRule(req.body);
      res.json(rule);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get rules
  async getRules(req: Request, res: Response) {
    try {
      const { contentTypeId } = req.params;
      const rules = await ValidationService.getRules(contentTypeId);
      res.json(rules);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Update rule
  async updateRule(req: Request, res: Response) {
    try {
      const { ruleId } = req.params;
      const updated = await ValidationService.updateRule(ruleId, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Delete rule
  async deleteRule(req: Request, res: Response) {
    try {
      const { ruleId } = req.params;
      await ValidationService.deleteRule(ruleId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
};
