import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/index.js';

export const ACCESS_COOKIE = 'accessToken';
export const REFRESH_COOKIE = 'refreshToken';
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

const parseDurationMs = (value: string, fallbackMs: number): number => {
  const match = /^(\d+)(s|m|h|d)?$/.exec(value.trim());
  if (!match) return fallbackMs;
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(match[1], 10) * (multipliers[match[2] || 's'] || 1000);
};

const cookieBase = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true' || config.nodeEnv === 'production',
  sameSite: (process.env.COOKIE_SAME_SITE as 'lax' | 'strict' | 'none' | undefined) || 'lax',
  path: '/',
} as const;

/**
 * Issue httpOnly session cookies after login/register/refresh/MFA-verify.
 * Body tokens are still returned for native clients; browsers must rely on
 * cookies (never persist tokens in localStorage).
 */
export const setAuthCookies = (
  res: Response,
  tokens: { accessToken: string; refreshToken: string }
): string => {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...cookieBase,
    maxAge: parseDurationMs(config.jwt.expiresIn, 7 * 86400000),
  });
  // Refresh cookie scoped to the auth path so it is only sent where needed
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...cookieBase,
    path: '/api/v1/auth',
    maxAge: parseDurationMs(config.jwt.refreshExpiresIn, 30 * 86400000),
  });
  // Readable by JS — paired with the x-csrf-token header (double-submit)
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: cookieBase.secure,
    sameSite: cookieBase.sameSite,
    path: '/',
    maxAge: parseDurationMs(config.jwt.expiresIn, 7 * 86400000),
  });
  return csrfToken;
};

export const clearAuthCookies = (res: Response): void => {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
};

/**
 * Double-submit CSRF protection for cookie-authenticated mutations.
 * Skipped when the request uses Bearer/API-key auth (non-ambient schemes
 * don't need CSRF) or carries no session cookie (e.g. webhooks, login).
 */
export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }
  if (req.headers.authorization || req.headers['x-api-key']) {
    next();
    return;
  }
  if (!req.cookies?.[ACCESS_COOKIE]) {
    next();
    return;
  }
  const header = req.headers[CSRF_HEADER] as string | undefined;
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  if (!header || !cookie || header !== cookie) {
    res.status(403).json({
      success: false,
      error: 'CSRF validation failed',
      message: 'Missing or invalid CSRF token',
    });
    return;
  }
  next();
};
