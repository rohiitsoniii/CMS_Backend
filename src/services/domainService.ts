import mongoose from 'mongoose';

export interface IDomain {
  _id: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  domain: string;
  status: 'pending' | 'verified' | 'active' | 'failed';
  verificationToken?: string;
  verifiedAt?: Date;
  sslStatus: 'pending' | 'provisioning' | 'active' | 'failed';
  sslCertId?: string;
  primary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const domainSchema = new mongoose.Schema<IDomain>({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  domain: { type: String, required: true, trim: true, lowercase: true },
  status: {
    type: String,
    enum: ['pending', 'verified', 'active', 'failed'],
    default: 'pending'
  },
  verificationToken: { type: String },
  verifiedAt: { type: Date },
  sslStatus: {
    type: String,
    enum: ['pending', 'provisioning', 'active', 'failed'],
    default: 'pending'
  },
  sslCertId: { type: String },
  primary: { type: Boolean, default: false }
}, { timestamps: true });

domainSchema.index({ tenantId: 1, domain: 1 }, { unique: true });
domainSchema.index({ domain: 1 });

export const Domain = mongoose.model<IDomain>('Domain', domainSchema);

export class DomainService {
  static async addDomain(tenantId: string, domain: string): Promise<any> {
    const existing = await Domain.findOne({ domain: domain.toLowerCase() });
    if (existing) {
      throw new Error('Domain is already in use');
    }

    const verificationToken = Math.random().toString(36).substring(2, 15);

    const domainRecord = await Domain.create({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      domain: domain.toLowerCase(),
      verificationToken,
      status: 'pending',
      sslStatus: 'pending'
    });

    return domainRecord;
  }

  static async verifyDomain(domainId: string, tenantId: string, token: string): Promise<boolean> {
    const domain = await Domain.findOne({
      _id: new mongoose.Types.ObjectId(domainId),
      tenantId: new mongoose.Types.ObjectId(tenantId)
    });

    if (!domain) throw new Error('Domain not found');

    if (domain.verificationToken !== token) {
      throw new Error('Invalid verification token');
    }

    domain.status = 'verified';
    domain.verifiedAt = new Date();
    domain.verificationToken = undefined;
    await domain.save();

    return true;
  }

  static async activateDomain(domainId: string, tenantId: string): Promise<any> {
    const domain = await Domain.findOne({
      _id: new mongoose.Types.ObjectId(domainId),
      tenantId: new mongoose.Types.ObjectId(tenantId),
      status: 'verified'
    });

    if (!domain) throw new Error('Domain not found or not verified');

    domain.status = 'active';
    domain.sslStatus = 'active';
    await domain.save();

    return domain;
  }

  static async getDomains(tenantId: string): Promise<any[]> {
    return Domain.find({ tenantId: new mongoose.Types.ObjectId(tenantId) }).sort({ primary: -1, createdAt: -1 });
  }

  static async deleteDomain(domainId: string, tenantId: string): Promise<boolean> {
    const result = await Domain.deleteOne({
      _id: new mongoose.Types.ObjectId(domainId),
      tenantId: new mongoose.Types.ObjectId(tenantId)
    });
    return result.deletedCount > 0;
  }

  static async setPrimaryDomain(domainId: string, tenantId: string): Promise<any> {
    await Domain.updateMany(
      { tenantId: new mongoose.Types.ObjectId(tenantId) },
      { $set: { primary: false } }
    );

    const domain = await Domain.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(domainId), tenantId: new mongoose.Types.ObjectId(tenantId) },
      { $set: { primary: true } },
      { new: true }
    );

    if (!domain) throw new Error('Domain not found');

    return domain;
  }

  static async getVerificationStatus(domain: string): Promise<{
    status: string;
    txtRecord: string;
  }> {
    const domainRecord = await Domain.findOne({ domain: domain.toLowerCase() });
    
    if (!domainRecord) {
      return { status: 'not_found', txtRecord: '' };
    }

    return {
      status: domainRecord.status,
      txtRecord: `headless-cms-verification=${domainRecord.verificationToken}`
    };
  }
}