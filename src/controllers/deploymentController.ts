import { Request, Response } from 'express';
import { DeploymentService } from '../services/deploymentService';

export const deploymentController = {
  async getIntegrations(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const integrations = await DeploymentService.getIntegrations(String(req.user!.tenantId), projectId);
      return res.json(integrations);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  async createIntegration(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const integration = await DeploymentService.createIntegration(String(req.user!.tenantId), projectId, req.body);
      return res.json(integration);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  async triggerDeploy(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await DeploymentService.triggerDeploy(String(req.user!.tenantId), id);
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  async deleteIntegration(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await DeploymentService.deleteIntegration(String(req.user!.tenantId), id);
      return res.json({ success: true, message: 'Integration deleted' });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }
};
