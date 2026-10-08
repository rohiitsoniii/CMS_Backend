import { Request, Response } from 'express';
import { SSOService, isProvider, verifyState, frontendUrl, SSOProvider } from '../services/ssoService.js';

const NONCE_COOKIE = 'sso_nonce';

const nonceCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // The provider redirects back with a top-level GET, which Lax cookies survive
  sameSite: 'lax' as const,
  maxAge: 10 * 60_000,
  path: '/api/v1/sso',
});

function providerParam(req: Request): SSOProvider | null {
  const p = req.params.provider || 'google';
  return isProvider(p) ? p : null;
}

export class SSOController {
  /** GET /sso/:provider/url (and legacy /sso/google/url) */
  static getLoginUrl(req: Request, res: Response) {
    const provider = providerParam(req);
    if (!provider) return res.status(404).json({ success: false, error: 'Unknown sign-in provider' });
    if (!SSOService.isEnabled(provider)) {
      return res.status(400).json({ success: false, error: `${provider} sign-in is not configured` });
    }
    const { url, nonce } = SSOService.getAuthUrl(provider, 'login');
    res.cookie(NONCE_COOKIE, nonce, nonceCookieOptions());
    return res.json({ success: true, data: { url } });
  }

  /** GET /sso/:provider/link-url — start linking a provider to the signed-in user */
  static getLinkUrl(req: Request, res: Response) {
    const provider = providerParam(req);
    if (!provider) return res.status(404).json({ success: false, error: 'Unknown sign-in provider' });
    if (!SSOService.isEnabled(provider)) {
      return res.status(400).json({ success: false, error: `${provider} sign-in is not configured` });
    }
    const { url, nonce } = SSOService.getAuthUrl(provider, 'link', String(req.user!._id));
    res.cookie(NONCE_COOKIE, nonce, nonceCookieOptions());
    return res.json({ success: true, data: { url } });
  }

  /**
   * GET /sso/:provider/callback — the provider redirects the browser here.
   * Sets session cookies and sends the browser back to the app.
   */
  static async handleCallback(req: Request, res: Response) {
    const provider = providerParam(req);
    const back = (query: Record<string, string>) => res.redirect(302, `${frontendUrl()}/sso/complete?${new URLSearchParams(query)}`);
    if (!provider) return back({ error: 'Unknown sign-in provider' });

    try {
      if (req.query.error) {
        return back({ error: String(req.query.error_description || req.query.error).slice(0, 200) });
      }
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!code) {
        return res.status(400).json({ success: false, error: 'Authorization code is required' });
      }
      const state = verifyState(String(req.query.state || ''), req.cookies?.[NONCE_COOKIE], provider);
      res.clearCookie(NONCE_COOKIE, { path: '/api/v1/sso' });

      const { user, isNewUser, linked } = await SSOService.handleCallback(provider, code, state);
      if (linked) return back({ linked: provider });

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

      return back({
        ...(user.twoFactorEnabled ? { mfa: '1' } : {}),
        ...(isNewUser ? { new: '1' } : {}),
      });
    } catch (error: any) {
      return back({ error: String(error?.message || 'Sign-in failed').slice(0, 200) });
    }
  }

  /** Legacy: POST /sso/google/link with a code obtained elsewhere is no longer supported. */
  static legacyLink(_req: Request, res: Response) {
    return res.status(410).json({
      success: false,
      error: 'Use GET /sso/:provider/link-url and complete the provider sign-in to link an account',
    });
  }

  static async unlink(req: Request, res: Response) {
    try {
      await SSOService.unlink(String(req.user!._id));
      return res.json({ success: true, message: 'Sign-in provider unlinked' });
    } catch (error: any) {
      const status = typeof error?.statusCode === 'number' ? error.statusCode : 400;
      return res.status(status).json({ success: false, error: error.message || 'Failed to unlink account' });
    }
  }

  static getSSOStatus(req: Request, res: Response) {
    return res.json({
      success: true,
      data: {
        ...SSOService.status(),
        linkedProvider: (req.user as any)?.provider && (req.user as any).provider !== 'email' ? (req.user as any).provider : null,
      },
    });
  }
}
