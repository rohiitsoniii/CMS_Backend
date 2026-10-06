import crypto from 'crypto';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/auth/google/callback';

export class SSOService {
  static getGoogleAuthUrl(): string {
    const state = crypto.randomBytes(16).toString('hex');
    
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'consent'
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  static async exchangeCodeForTokens(code: string): Promise<{
    access_token: string;
    id_token: string;
    refresh_token?: string;
  }> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    if (!response.ok) {
      throw new Error('Failed to exchange code for tokens');
    }

    return response.json();
  }

  static async getGoogleUserInfo(accessToken: string): Promise<{
    id: string;
    email: string;
    name: string;
    picture?: string;
  }> {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    return response.json();
  }

  static async handleGoogleCallback(code: string): Promise<{
    user: any;
    isNewUser: boolean;
  }> {
    const tokens = await this.exchangeCodeForTokens(code);
    const googleUser = await this.getGoogleUserInfo(tokens.access_token);

    let user = await User.findOne({ email: googleUser.email });

    if (!user) {
      const tenant = await Tenant.create({
        name: googleUser.name || 'Google User',
        slug: googleUser.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-'),
        email: googleUser.email,
        password: crypto.randomBytes(32).toString('hex'),
        company: 'Google SSO',
        subscription: {
          plan: 'free',
          startDate: new Date(),
          isActive: true,
          billingCycle: 'monthly'
        }
      });

      user = await User.create({
        tenantId: tenant._id,
        firstName: googleUser.name?.split(' ')[0] || 'Google',
        lastName: googleUser.name?.split(' ').slice(1).join(' ') || 'User',
        email: googleUser.email,
        password: crypto.randomBytes(32).toString('hex'),
        role: 'owner',
        avatar: googleUser.picture,
        isEmailVerified: true,
        provider: 'google',
        providerId: googleUser.id
      });

      return { user, isNewUser: true };
    }

    user.lastLoginAt = new Date();
    await user.save();

    return { user, isNewUser: false };
  }

  static async linkGoogleAccount(userId: string, code: string): Promise<any> {
    const tokens = await this.exchangeCodeForTokens(code);
    const googleUser = await this.getGoogleUserInfo(tokens.access_token);

    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    user.provider = 'google';
    user.providerId = googleUser.id;
    user.avatar = user.avatar || googleUser.picture;
    await user.save();

    return user;
  }

  static async unlinkGoogleAccount(userId: string): Promise<boolean> {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    user.provider = 'email';
    user.providerId = undefined;
    await user.save();

    return true;
  }

  static isGoogleSSOEnabled(): boolean {
    return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
  }
}