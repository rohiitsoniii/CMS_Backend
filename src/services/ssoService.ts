import crypto from 'crypto';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';

/**
 * Social / enterprise sign-in (OAuth 2.0 / OIDC): Google, Microsoft, GitHub.
 *
 * Server-side authorization-code flow:
 *   GET /sso/:provider/url       → provider login URL (state is signed + bound to a cookie)
 *   GET /sso/:provider/callback  → exchange code, sign in / sign up / link, redirect to the app
 */

export type SSOProvider = 'google' | 'microsoft' | 'github';

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  extraAuthParams?: Record<string, string>;
}

function providerConfig(p: SSOProvider): ProviderConfig {
  switch (p) {
    case 'google':
      return {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scope: 'openid email profile',
        extraAuthParams: { prompt: 'select_account' },
      };
    case 'microsoft': {
      const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
      return {
        clientId: process.env.MICROSOFT_CLIENT_ID || '',
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
        authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        scope: 'openid email profile User.Read',
        extraAuthParams: { prompt: 'select_account' },
      };
    }
    case 'github':
      return {
        clientId: process.env.GITHUB_CLIENT_ID || '',
        clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scope: 'read:user user:email',
      };
  }
}

export const SSO_PROVIDERS: SSOProvider[] = ['google', 'microsoft', 'github'];
export const isProvider = (p: unknown): p is SSOProvider => SSO_PROVIDERS.includes(p as SSOProvider);

const apiBase = () => (process.env.PUBLIC_API_URL || `http://localhost:${config.port}`).replace(/\/+$/, '');
export const frontendUrl = () => (config.frontendUrl || 'http://localhost:5174').replace(/\/+$/, '');

function redirectUri(p: SSOProvider): string {
  const legacy = p === 'google' ? process.env.GOOGLE_REDIRECT_URI : undefined;
  // Legacy GOOGLE_REDIRECT_URI pointed at a frontend route that never existed; only honour API callbacks
  if (legacy && legacy.includes('/api/v1/sso/')) return legacy;
  return `${apiBase()}/api/v1/sso/${p}/callback`;
}

// ---------------------------------------------------------------------------
// Signed state (CSRF protection), bound to a browser cookie nonce
// ---------------------------------------------------------------------------

interface StatePayload {
  p: SSOProvider;
  n: string; // nonce, also stored in an httpOnly cookie
  exp: number;
  mode: 'login' | 'link';
  uid?: string;
}

const hmac = (data: string) => crypto.createHmac('sha256', config.jwt.secret).update(data).digest('base64url');

export function createState(payload: Omit<StatePayload, 'exp'>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  return `${body}.${hmac(body)}`;
}

export function verifyState(state: string, nonceCookie: string | undefined, provider: SSOProvider): StatePayload {
  const [body, sig] = String(state || '').split('.');
  const expected = body ? hmac(body) : '';
  if (!body || !sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new AppError('Invalid sign-in state. Please try again.', 400, 'SSO_STATE_INVALID');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as StatePayload;
  if (payload.exp < Date.now()) throw new AppError('Sign-in took too long. Please try again.', 400, 'SSO_STATE_EXPIRED');
  if (payload.p !== provider) throw new AppError('Invalid sign-in state.', 400, 'SSO_STATE_INVALID');
  if (!nonceCookie || nonceCookie !== payload.n) throw new AppError('Sign-in must be completed in the same browser.', 400, 'SSO_STATE_MISMATCH');
  return payload;
}

// ---------------------------------------------------------------------------
// Provider calls
// ---------------------------------------------------------------------------

interface SSOProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

async function exchangeCode(p: SSOProvider, code: string): Promise<string> {
  const cfg = providerConfig(p);
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri(p),
      grant_type: 'authorization_code',
    }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new AppError('Failed to exchange code for tokens', 502, 'SSO_EXCHANGE_FAILED');
  }
  return data.access_token;
}

async function getJson(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'HeadlessCMS' } });
  if (!res.ok) throw new AppError('Failed to get user info', 502, 'SSO_USERINFO_FAILED');
  return res.json() as Promise<any>;
}

async function fetchProfile(p: SSOProvider, token: string): Promise<SSOProfile> {
  if (p === 'google') {
    const u = await getJson('https://openidconnect.googleapis.com/v1/userinfo', token);
    return { id: u.sub, email: u.email, emailVerified: u.email_verified === true, name: u.name || u.email, picture: u.picture };
  }
  if (p === 'microsoft') {
    const u = await getJson('https://graph.microsoft.com/oidc/userinfo', token);
    // Work/school accounts are verified by the directory
    return { id: u.sub, email: u.email || u.preferred_username, emailVerified: Boolean(u.email || u.preferred_username), name: u.name || u.email, picture: undefined };
  }
  const u = await getJson('https://api.github.com/user', token);
  const emails: Array<{ email: string; primary: boolean; verified: boolean }> = await getJson('https://api.github.com/user/emails', token);
  const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
  return { id: String(u.id), email: primary?.email || u.email, emailVerified: Boolean(primary), name: u.name || u.login, picture: u.avatar_url };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class SSOService {
  static isEnabled(p: SSOProvider): boolean {
    const cfg = providerConfig(p);
    return Boolean(cfg.clientId && cfg.clientSecret);
  }

  static status(): Record<SSOProvider, boolean> {
    return { google: this.isEnabled('google'), microsoft: this.isEnabled('microsoft'), github: this.isEnabled('github') };
  }

  /** Provider login URL + the nonce the caller must store in a cookie. */
  static getAuthUrl(p: SSOProvider, mode: 'login' | 'link' = 'login', uid?: string): { url: string; nonce: string } {
    if (!this.isEnabled(p)) throw new AppError(`${p} sign-in is not configured`, 400, 'SSO_NOT_CONFIGURED');
    const cfg = providerConfig(p);
    const nonce = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri(p),
      response_type: 'code',
      scope: cfg.scope,
      state: createState({ p, n: nonce, mode, uid }),
      ...(cfg.extraAuthParams || {}),
    });
    return { url: `${cfg.authorizeUrl}?${params.toString()}`, nonce };
  }

  /** Back-compat for the existing Google URL endpoint. */
  static getGoogleAuthUrl(): string {
    return this.getAuthUrl('google').url;
  }

  static async handleCallback(p: SSOProvider, code: string, state: StatePayload): Promise<{ user: any; isNewUser: boolean; linked?: boolean }> {
    const token = await exchangeCode(p, code);
    const profile = await fetchProfile(p, token);
    if (!profile.email) throw new AppError('Your account has no email address we can use.', 400, 'SSO_NO_EMAIL');
    const email = profile.email.toLowerCase();

    if (state.mode === 'link') {
      const user = await User.findById(state.uid);
      if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      (user as any).provider = p;
      (user as any).providerId = profile.id;
      user.avatar = user.avatar || profile.picture;
      await user.save();
      return { user, isNewUser: false, linked: true };
    }

    let user = await User.findOne({ email }).sort({ lastLoginAt: -1 });

    if (user) {
      // Never sign into an existing account on an unverified provider email
      if (!profile.emailVerified) {
        throw new AppError('Please verify this email with your sign-in provider first.', 403, 'SSO_EMAIL_UNVERIFIED');
      }
      if (user.isActive === false) throw new AppError('This account is disabled.', 403, 'ACCOUNT_DISABLED');
      user.lastLoginAt = new Date();
      await user.save();
      return { user, isNewUser: false };
    }

    const baseSlug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
    const slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;
    const tenant = await Tenant.create({
      name: profile.name || baseSlug,
      slug,
      email,
      password: crypto.randomBytes(32).toString('hex'),
      subscription: { plan: 'free', startDate: new Date(), isActive: true, billingCycle: 'monthly' },
    });

    const [firstName, ...rest] = String(profile.name || '').trim().split(/\s+/);
    user = await User.create({
      tenantId: tenant._id,
      firstName: firstName || 'New',
      lastName: rest.join(' ') || 'User',
      email,
      password: crypto.randomBytes(32).toString('hex'),
      role: 'owner',
      avatar: profile.picture,
      isEmailVerified: profile.emailVerified,
      lastLoginAt: new Date(),
    } as any);
    (user as any).provider = p;
    (user as any).providerId = profile.id;

    return { user, isNewUser: true };
  }

  static async unlink(userId: string): Promise<boolean> {
    const user = await User.findById(userId);
    if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    (user as any).provider = 'email';
    (user as any).providerId = undefined;
    await user.save();
    return true;
  }

  static isGoogleSSOEnabled(): boolean {
    return this.isEnabled('google');
  }
}
