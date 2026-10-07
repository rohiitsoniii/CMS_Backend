import { Request, Response } from 'express';
import { EnvVariableService } from '../services/envVariableService.js';

export class EnvVariableController {
  static async createVariable(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId.toString();
      const userId = req.user!.id;
      const { key, value, isSecret, description, category, environment, projectId } = req.body;

      if (!key || !value) {
        return res.status(400).json({
          success: false,
          error: 'Key and value are required'
        });
      }

      const variable = await EnvVariableService.createVariable(
        { tenantId, projectId, key, value, isSecret, description, category, environment },
        userId
      );

      return res.status(201).json({
        success: true,
        data: {
          ...variable.toObject(),
          value: variable.isSecret ? '••••••••' : variable.value
        }
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  static async updateVariable(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId.toString();
      const { id } = req.params;
      const { value, description, category, environment } = req.body;

      const variable = await EnvVariableService.updateVariable(id, tenantId, {
        value,
        description,
        category,
        environment
      });

      if (!variable) {
        return res.status(404).json({
          success: false,
          error: 'Variable not found'
        });
      }

      return res.json({
        success: true,
        data: {
          ...variable.toObject(),
          value: variable.isSecret ? '••••••••' : variable.value
        }
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async deleteVariable(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId.toString();
      const { id } = req.params;

      const deleted = await EnvVariableService.deleteVariable(id, tenantId);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Variable not found'
        });
      }

      return res.json({
        success: true,
        message: 'Variable deleted successfully'
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async getVariables(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId.toString();
      const { projectId, category, environment, includeSecrets } = req.query;

      const variables = await EnvVariableService.getVariables(tenantId, {
        projectId: projectId as string,
        category: category as string,
        environment: environment as string,
        includeSecrets: includeSecrets === 'true'
      });

      return res.json({
        success: true,
        data: variables
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async getVariable(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId.toString();
      const { id } = req.params;

      const variable = await EnvVariableService.getVariableById(id, tenantId);

      if (!variable) {
        return res.status(404).json({
          success: false,
          error: 'Variable not found'
        });
      }

      return res.json({
        success: true,
        data: {
          ...variable.toObject(),
          value: variable.isSecret ? '••••••••' : variable.value
        }
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async exportVariables(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId.toString();
      const { includeSecrets } = req.query;

      const content = await EnvVariableService.exportVariables(tenantId, {
        includeSecrets: includeSecrets === 'true'
      });

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename=".env"');
      return res.send(content);
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async bulkCreate(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId.toString();
      const userId = req.user!.id;
      const { variables } = req.body;

      if (!Array.isArray(variables) || variables.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Variables array is required'
        });
      }

      const result = await EnvVariableService.bulkCreateVariables(tenantId, variables, userId);

      return res.status(201).json({
        success: true,
        message: `${Object.keys(result.insertedIds).length} variables created`
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}