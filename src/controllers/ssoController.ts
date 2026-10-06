import { Request, Response } from 'express';
import { SSOService } from '../services/ssoService.js';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export class SSOController {
  static getGoogleLoginUrl(req: Request, res: Response) {
    try {
      if (!SSOService.isGoogleSSOEnabled()) {
        return res.status(400).json({
          success: false,
          error: 'Google SSO is not configured'
        });
      }

      const authUrl = SSOService.getGoogleAuthUrl();
      res.json({
        success: true,
        data: { url: authUrl }
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async handleGoogleCallback(req: Request, res: Response) {
    try {
      const { code, state } = req.query;

      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'Authorization code is required'
        });
      }

      const { user, isNewUser } = await SSOService.handleGoogleCallback(code as string);

      const { generateTokens } = await import('../middleware/auth.js');
      const tokens = generateTokens(
        user._id.toString(), 
        user.tenantId?.toString() || '', 
        user.role, 
        false
      );

      if (user.twoFactorEnabled) {
        return res.json({
          success: true,
          data: {
            mfaRequired: true,
            tokens,
            isNewUser
          }
        });
      }

      res.json({
        success: true,
        data: {
          tokens,
          user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role
          },
          isNewUser
        }
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async linkGoogleAccount(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'Authorization code is required'
        });
      }

      const user = await SSOService.linkGoogleAccount(userId, code);

      res.json({
        success: true,
        message: 'Google account linked successfully',
        data: { provider: user.provider }
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  static async unlinkGoogleAccount(req: Request, res: Response) {
    try {
      const userId = req.user!.id;

      await SSOService.unlinkGoogleAccount(userId);

      res.json({
        success: true,
        message: 'Google account unlinked successfully'
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static getSSOStatus(req: Request, res: Response) {
    res.json({
      success: true,
      data: {
        google: SSOService.isGoogleSSOEnabled()
      }
    });
  }
}