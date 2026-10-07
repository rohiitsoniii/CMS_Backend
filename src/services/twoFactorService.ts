import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { TwoFactorAuth } from '../models/TwoFactorAuth.js';
import { User } from '../models/User.js';
import mongoose from 'mongoose';

export class TwoFactorService {
  static async generateSecret(userId: string): Promise<{
    secret: string;
    qrCodeUrl: string;
    backupCodes: string[];
  }> {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const existing = await TwoFactorAuth.findOne({ userId: new mongoose.Types.ObjectId(userId) });
    if (existing?.isEnabled) {
      throw new Error('2FA is already enabled for this user');
    }

    const secret = speakeasy.generateSecret({
      name: `Headless CMS (${user.email})`,
      issuer: 'Headless CMS'
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url || '');

    const backupCodes = Array.from({ length: 10 }, () => 
      crypto.randomBytes(4).toString('hex').toUpperCase()
    );

    await TwoFactorAuth.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId) },
      {
        userId: new mongoose.Types.ObjectId(userId),
        secret: secret.base32 || '',
        qrCodeUrl,
        backupCodes,
        isEnabled: false
      },
      { upsert: true, new: true }
    );

    return {
      secret: secret.base32 || '',
      qrCodeUrl,
      backupCodes
    };
  }

  static async enableTwoFactor(userId: string, token: string): Promise<boolean> {
    const twoFactor = await TwoFactorAuth.findOne({ userId: new mongoose.Types.ObjectId(userId) });
    if (!twoFactor) throw new Error('2FA not set up for this user');

    const verified = speakeasy.totp.verify({
      secret: twoFactor.secret,
      encoding: 'base32',
      token,
      window: 1
    });

    if (!verified) {
      const isBackupCode = twoFactor.backupCodes.includes(token.toUpperCase());
      if (!isBackupCode) {
        throw new Error('Invalid verification code');
      }
      await this.useBackupCode(userId, token.toUpperCase());
    }

    twoFactor.isEnabled = true;
    twoFactor.enabledAt = new Date();
    twoFactor.backupCodes = twoFactor.backupCodes.filter(
      c => c !== token.toUpperCase()
    );
    await twoFactor.save();

    await User.findByIdAndUpdate(userId, { $set: { twoFactorEnabled: true } });

    return true;
  }

  static async verifyToken(userId: string, token: string): Promise<boolean> {
    const twoFactor = await TwoFactorAuth.findOne({ 
      userId: new mongoose.Types.ObjectId(userId),
      isEnabled: true 
    });
    
    if (!twoFactor) return false;

    const verified = speakeasy.totp.verify({
      secret: twoFactor.secret,
      encoding: 'base32',
      token,
      window: 1
    });

    if (verified) return true;

    if (twoFactor.backupCodes.includes(token.toUpperCase())) {
      await this.useBackupCode(userId, token.toUpperCase());
      return true;
    }

    return false;
  }

  static async useBackupCode(userId: string, code: string): Promise<void> {
    await TwoFactorAuth.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId) },
      { $pull: { backupCodes: code.toUpperCase() } }
    );
  }

  static async disableTwoFactor(userId: string, token: string): Promise<boolean> {
    const twoFactor = await TwoFactorAuth.findOne({ 
      userId: new mongoose.Types.ObjectId(userId),
      isEnabled: true 
    });
    
    if (!twoFactor) throw new Error('2FA is not enabled');

    const verified = speakeasy.totp.verify({
      secret: twoFactor.secret,
      encoding: 'base32',
      token,
      window: 1
    });

    if (!verified && !twoFactor.backupCodes.includes(token.toUpperCase())) {
      throw new Error('Invalid verification code');
    }

    await TwoFactorAuth.findByIdAndDelete(twoFactor._id);
    await User.findByIdAndUpdate(userId, { $set: { twoFactorEnabled: false } });

    return true;
  }

  static async getTwoFactorStatus(userId: string): Promise<{
    isEnabled: boolean;
    backupCodesRemaining: number;
  }> {
    const twoFactor = await TwoFactorAuth.findOne({ userId: new mongoose.Types.ObjectId(userId) });
    
    if (!twoFactor) {
      return { isEnabled: false, backupCodesRemaining: 0 };
    }

    return {
      isEnabled: twoFactor.isEnabled,
      backupCodesRemaining: twoFactor.backupCodes.length
    };
  }

  static async regenerateBackupCodes(userId: string): Promise<string[]> {
    const twoFactor = await TwoFactorAuth.findOne({ 
      userId: new mongoose.Types.ObjectId(userId),
      isEnabled: true 
    });
    
    if (!twoFactor) throw new Error('2FA is not enabled');

    const newBackupCodes = Array.from({ length: 10 }, () => 
      crypto.randomBytes(4).toString('hex').toUpperCase()
    );

    twoFactor.backupCodes = newBackupCodes;
    await twoFactor.save();

    return newBackupCodes;
  }
}