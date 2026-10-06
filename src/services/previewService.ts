import crypto from 'crypto';
import { PreviewToken } from '../models/PreviewToken.js';
import { Content } from '../models/Content.js';
import { ContentType } from '../models/ContentType.js';
import mongoose from 'mongoose';

export class PreviewService {
  static async generatePreviewToken(
    contentId: string,
    userId: string,
    options: {
      expiresIn?: number; // minutes
      projectId: string;
      contentTypeId: string;
      tenantId: string;
    }
  ): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (options.expiresIn || 60) * 60 * 1000);

    await PreviewToken.create({
      token,
      contentId: new mongoose.Types.ObjectId(contentId),
      projectId: new mongoose.Types.ObjectId(options.projectId),
      contentTypeId: new mongoose.Types.ObjectId(options.contentTypeId),
      tenantId: new mongoose.Types.ObjectId(options.tenantId),
      expiresAt,
      createdBy: new mongoose.Types.ObjectId(userId)
    });

    return token;
  }

  static async getPreviewContent(token: string): Promise<{
    content: any;
    contentType: any;
    expiresAt: Date;
  } | null> {
    const previewToken = await PreviewToken.findOne({ token });
    
    if (!previewToken) {
      return null;
    }

    if (previewToken.isUsed || previewToken.isExpired()) {
      return null;
    }

    const [content, contentType] = await Promise.all([
      Content.findById(previewToken.contentId),
      ContentType.findById(previewToken.contentTypeId)
    ]);

    if (!content || !contentType) {
      return null;
    }

    return {
      content: content.toObject(),
      contentType: contentType.toObject(),
      expiresAt: previewToken.expiresAt
    };
  }

  static async markTokenAsUsed(token: string): Promise<void> {
    await PreviewToken.findOneAndUpdate(
      { token },
      { isUsed: true, usedAt: new Date() }
    );
  }

  static async getPreviewUrl(
    contentId: string,
    userId: string,
    baseUrl: string,
    options: {
      expiresIn?: number;
      projectId: string;
      contentTypeId: string;
      tenantId: string;
    }
  ): Promise<string> {
    const token = await this.generatePreviewToken(contentId, userId, options);
    return `${baseUrl}/api/v1/preview/${token}`;
  }

  static async listPreviewTokens(
    tenantId: string,
    options: {
      contentId?: string;
      projectId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ tokens: any[]; total: number }> {
    const query: any = { tenantId: new mongoose.Types.ObjectId(tenantId) };
    
    if (options.contentId) {
      query.contentId = new mongoose.Types.ObjectId(options.contentId);
    }
    if (options.projectId) {
      query.projectId = new mongoose.Types.ObjectId(options.projectId);
    }

    const [tokens, total] = await Promise.all([
      PreviewToken.find(query)
        .populate('contentId', 'title status')
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(options.offset || 0)
        .limit(options.limit || 20),
      PreviewToken.countDocuments(query)
    ]);

    return { tokens, total };
  }

  static async revokePreviewToken(tokenId: string, tenantId: string): Promise<boolean> {
    const result = await PreviewToken.findOneAndDelete({
      _id: new mongoose.Types.ObjectId(tokenId),
      tenantId: new mongoose.Types.ObjectId(tenantId)
    });
    return !!result;
  }

  static async cleanupExpiredTokens(): Promise<number> {
    const result = await PreviewToken.deleteMany({
      $or: [
        { isUsed: true },
        { expiresAt: { $lt: new Date() } }
      ]
    });
    return result.deletedCount;
  }
}