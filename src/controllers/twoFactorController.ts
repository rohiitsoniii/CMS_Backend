import { Request, Response } from 'express';
import { TwoFactorService } from '../services/twoFactorService.js';

export class TwoFactorController {
  static async setupTwoFactor(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const result = await TwoFactorService.generateSecret(userId);

      return res.json({
        success: true,
        data: {
          secret: result.secret,
          qrCodeUrl: result.qrCodeUrl,
          backupCodes: result.backupCodes
        }
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  static async enableTwoFactor(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'Verification token is required'
        });
      }

      await TwoFactorService.enableTwoFactor(userId, token);

      return res.json({
        success: true,
        message: 'Two-factor authentication enabled successfully'
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  static async verifyTwoFactor(req: Request, res: Response) {
    try {
      const { token } = req.body;
      const userId = req.userId; // Requires partial auth (e.g., token with mfaVerified=false)

      if (!userId || !token) {
        return res.status(400).json({
          success: false,
          error: 'Token is required'
        });
      }

      const isValid = await TwoFactorService.verifyToken(userId, token);

      if (!isValid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid 2FA token'
        });
      }

      // Re-issue tokens with mfaVerified = true
      const user = await import('../models/User.js').then(m => m.User.findById(userId));
      const tenantId = user?.tenantId.toString() || req.tenantId || '';

      const { generateTokens } = await import('../middleware/auth.js');
      const { setAuthCookies } = await import('../middleware/cookies.js');
      const tokens = generateTokens(userId, tenantId, user?.role || 'editor', true, user?.tokenVersion || 0);
      setAuthCookies(res, tokens);

      return res.json({
        success: true,
        data: { tokens }
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  static async disableTwoFactor(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'Verification token is required'
        });
      }

      await TwoFactorService.disableTwoFactor(userId, token);

      return res.json({
        success: true,
        message: 'Two-factor authentication disabled'
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  static async getStatus(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const status = await TwoFactorService.getTwoFactorStatus(userId);

      return res.json({
        success: true,
        data: status
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async regenerateBackupCodes(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const codes = await TwoFactorService.regenerateBackupCodes(userId);

      return res.json({
        success: true,
        data: { backupCodes: codes },
        message: 'New backup codes generated. Store these securely.'
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
}