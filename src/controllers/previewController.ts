import { Request, Response } from 'express';
import { PreviewService } from '../services/previewService.js';

export class PreviewController {
  static async generateToken(req: Request, res: Response) {
    try {
      const { contentId } = req.params;
      const { expiresIn = 60, projectId, contentTypeId } = req.body;
      const userId = req.user!.id;
      const tenantId = req.user!.tenantId.toString();

      if (!projectId || !contentTypeId) {
        return res.status(400).json({
          success: false,
          error: 'projectId and contentTypeId are required'
        });
      }

      const token = await PreviewService.generatePreviewToken(
        contentId,
        userId,
        { expiresIn, projectId, contentTypeId, tenantId }
      );

      const previewUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/preview/${token}`;

      return res.json({
        success: true,
        data: {
          token,
          previewUrl,
          expiresIn
        }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getPreview(req: Request, res: Response) {
    try {
      const { token } = req.params;

      const preview = await PreviewService.getPreviewContent(token);

      if (!preview) {
        return res.status(404).json({
          success: false,
          error: 'Preview token not found or expired'
        });
      }

      return res.json({
        success: true,
        data: preview
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  static async listTokens(req: Request, res: Response) {
    try {
      const tenantId = req.user!.tenantId.toString();
      const { contentId, projectId, limit = 20, offset = 0 } = req.query;

      const result = await PreviewService.listPreviewTokens(tenantId, {
        contentId: contentId as string,
        projectId: projectId as string,
        limit: Number(limit),
        offset: Number(offset)
      });

      return res.json({
        success: true,
        data: result.tokens,
        pagination: {
          total: result.total,
          limit: Number(limit),
          offset: Number(offset)
        }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  static async revokeToken(req: Request, res: Response) {
    try {
      const { tokenId } = req.params;
      const tenantId = req.user!.tenantId.toString();

      const revoked = await PreviewService.revokePreviewToken(tokenId, tenantId);

      if (!revoked) {
        return res.status(404).json({
          success: false,
          error: 'Token not found'
        });
      }

      return res.json({
        success: true,
        message: 'Token revoked successfully'
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}