import { Request, Response } from 'express';
import { SSOService } from '../services/ssoService.js';

export class SSOController {
  static getGoogleLoginUrl(_req: Request, res: Response) {
    try {
      if (!SSOService.isGoogleSSOEnabled()) {
        return res.status(400).json({
          success: false,
          error: 'Google SSO is not configured'
        });
      }

      const authUrl = SSOService.getGoogleAuthUrl();
      return res.json({
        success: true,
        data: { url: authUrl }
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async handleGoogleCallback(req: Request, res: Response) {
    try {
      const { code } = req.query;

      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'Authorization code is required'
        });
      }

      const { user, isNewUser } = await SSOService.handleGoogleCallback(code as string);

      const { generateTokens } = await import('../middleware/auth.js');
      const { setAuthCookies } = await import('../middleware/cookies.js');
      const tokens = generateTokens(
        user._id.toString(),
        user.tenantId?.toString() || '',
        user.role,
        false,
        (user as any).tokenVersion || 0
      );
      setAuthCookies(res, tokens);

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

      return res.json({
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
      const status = typeof error?.statusCode === 'number' ? error.statusCode : 502;
      return res.status(status).json({
        success: false,
        error: error.message || 'Google authentication failed'
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

      return res.json({
        success: true,
        message: 'Google account linked successfully',
        data: { provider: user.provider }
      });
    } catch (error: any) {
      const status = typeof error?.statusCode === 'number' ? error.statusCode : 400;
      return res.status(status).json({
        success: false,
        error: error.message || 'Failed to link Google account'
      });
    }
  }

  static async unlinkGoogleAccount(req: Request, res: Response) {
    try {
      const userId = req.user!.id;

      await SSOService.unlinkGoogleAccount(userId);

      return res.json({
        success: true,
        message: 'Google account unlinked successfully'
      });
    } catch (error: any) {
      const status = typeof error?.statusCode === 'number' ? error.statusCode : 400;
      return res.status(status).json({
        success: false,
        error: error.message || 'Failed to unlink Google account'
      });
    }
  }

  static getSSOStatus(_req: Request, res: Response) {
    return res.json({
      success: true,
      data: {
        google: SSOService.isGoogleSSOEnabled()
      }
    });
  }
}