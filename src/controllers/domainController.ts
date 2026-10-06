import { Request, Response } from 'express';
import { DomainService } from '../services/domainService.js';

export class DomainController {
  static async addDomain(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const { domain } = req.body;

      if (!domain) {
        return res.status(400).json({
          success: false,
          error: 'Domain is required'
        });
      }

      const domainRecord = await DomainService.addDomain(tenantId, domain);

      res.status(201).json({
        success: true,
        data: {
          ...domainRecord.toObject(),
          verificationToken: undefined
        },
        message: 'Domain added. Please add TXT record to verify.'
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  static async verifyDomain(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const { domainId } = req.params;
      const { token } = req.body;

      const verified = await DomainService.verifyDomain(domainId, tenantId, token);

      res.json({
        success: true,
        message: 'Domain verified successfully'
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  static async activateDomain(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const { domainId } = req.params;

      const domain = await DomainService.activateDomain(domainId, tenantId);

      res.json({
        success: true,
        data: domain,
        message: 'Domain is now active'
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  static async getDomains(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const domains = await DomainService.getDomains(tenantId);

      res.json({
        success: true,
        data: domains
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async deleteDomain(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const { domainId } = req.params;

      const deleted = await DomainService.deleteDomain(domainId, tenantId);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Domain not found'
        });
      }

      res.json({
        success: true,
        message: 'Domain deleted successfully'
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async setPrimaryDomain(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId;
      const { domainId } = req.params;

      const domain = await DomainService.setPrimaryDomain(domainId, tenantId);

      res.json({
        success: true,
        data: domain,
        message: 'Primary domain updated'
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
}