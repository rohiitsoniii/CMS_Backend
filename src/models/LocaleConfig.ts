import mongoose, { Schema, Document, Model } from 'mongoose';
import { encrypt, decrypt, isEncrypted } from '../services/cryptoService';


/**
 * Locale Configuration Model
 * Manages supported locales for a tenant
 */

export interface ILocale {
  code: string; // e.g., 'en', 'es', 'fr'
  name: string; // e.g., 'English', 'Spanish'
  direction: 'ltr' | 'rtl';
  isDefault: boolean;
  isEnabled: boolean;
}

export interface ILocaleConfig extends Document {
  tenantId: mongoose.Types.ObjectId;
  
  // Locale settings
  defaultLocale: string; // e.g., 'en'
  fallbackLocale: string; // e.g., 'en'
  locales: ILocale[];
  
  // Fallback chain
  fallbackChain: {
    [locale: string]: string[]; // e.g., { 'es': ['en'], 'fr': ['en'] }
  };
  
  // Auto-translation settings
  autoTranslate: boolean;
  translationProvider?: 'google' | 'deepl' | 'aws';
  translationApiKey?: string;           // Virtual — decrypted on read, encrypted on save
  translationApiKeyEncrypted?: string;  // Actual stored (encrypted) value
  autoTranslateFields: string[];
  
  // Custom glossary for the tenant
  glossary: {
    [source: string]: string;
  };
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
}

const LocaleSchema = new Schema<ILocale>({
  code: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: /^[a-z]{2}(-[A-Z]{2,3})?$/ // e.g., 'en', 'en-US', 'zh-TW'
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  direction: {
    type: String,
    enum: ['ltr', 'rtl'],
    default: 'ltr'
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  isEnabled: {
    type: Boolean,
    default: true
  }
}, { _id: false });

const LocaleConfigSchema = new Schema<ILocaleConfig>({
  tenantId: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    unique: true,
    index: true
  },
  defaultLocale: {
    type: String,
    required: true,
    default: 'en'
  },
  fallbackLocale: {
    type: String,
    required: true,
    default: 'en'
  },
  locales: {
    type: [LocaleSchema],
    required: true,
    validate: {
      validator: function(locales: ILocale[]) {
        return locales.length > 0;
      },
      message: 'At least one locale must be configured'
    }
  },
  fallbackChain: {
    type: Schema.Types.Mixed,
    default: {}
  },
  autoTranslate: {
    type: Boolean,
    default: false
  },
  translationProvider: {
    type: String,
    enum: ['google', 'deepl', 'aws'],
    default: 'google'
  },
  translationApiKey: {
    type: String,
    select: false, // Security: never expose in default queries
  },
  // Renamed internal storage field — stores AES-256 encrypted value
  translationApiKeyEncrypted: {
    type: String,
    select: false,
  },
  autoTranslateFields: {
    type: [String],
    default: ['title', 'name', 'content', 'description', 'body']
  },
  glossary: {
    type: Schema.Types.Mixed,
    default: {}
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Indexes
LocaleConfigSchema.index({ tenantId: 1 }, { unique: true });

// Virtual for enabled locales
LocaleConfigSchema.virtual('enabledLocales').get(function() {
  return this.locales.filter(l => l.isEnabled);
});

// Methods
LocaleConfigSchema.methods.getLocale = function(code: string): ILocale | undefined {
  return this.locales.find(l => l.code === code);
};

LocaleConfigSchema.methods.isLocaleEnabled = function(code: string): boolean {
  const locale = this.getLocale(code);
  return locale ? locale.isEnabled : false;
};

LocaleConfigSchema.methods.getDefaultLocale = function(): ILocale | undefined {
  return this.locales.find(l => l.isDefault);
};

LocaleConfigSchema.methods.getFallbackChain = function(locale: string): string[] {
  return this.fallbackChain[locale] || [this.fallbackLocale];
};

// Static methods
LocaleConfigSchema.statics.findByTenant = function(tenantId: mongoose.Types.ObjectId) {
  return this.findOne({ tenantId });
};

LocaleConfigSchema.statics.getOrCreateDefault = async function(
  tenantId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId
) {
  let config = await this.findOne({ tenantId });
  
  if (!config) {
    // Create default configuration
    config = new this({
      tenantId,
      defaultLocale: 'en',
      fallbackLocale: 'en',
      locales: [
        {
          code: 'en',
          name: 'English',
          direction: 'ltr',
          isDefault: true,
          isEnabled: true
        }
      ],
      fallbackChain: {},
      autoTranslate: false,
      createdBy: userId,
      updatedBy: userId
    });
    await config.save();
  }
  
  return config;
};

// Pre-save validation
LocaleConfigSchema.pre('save', async function(next) {
  // Ensure exactly one default locale
  const defaultLocales = this.locales.filter(l => l.isDefault);
  if (defaultLocales.length !== 1) {
    throw new Error('Exactly one locale must be set as default');
  }
  
  // Ensure default locale exists in locales array
  const hasDefaultLocale = this.locales.some(l => l.code === this.defaultLocale);
  if (!hasDefaultLocale) {
    throw new Error(`Default locale "${this.defaultLocale}" must exist in locales array`);
  }
  
  // Ensure fallback locale exists in locales array
  const hasFallbackLocale = this.locales.some(l => l.code === this.fallbackLocale);
  if (!hasFallbackLocale) {
    throw new Error(`Fallback locale "${this.fallbackLocale}" must exist in locales array`);
  }
  
  // Validate locale codes are unique
  const localeCodes = this.locales.map(l => l.code);
  const uniqueCodes = new Set(localeCodes);
  if (localeCodes.length !== uniqueCodes.size) {
    throw new Error('Locale codes must be unique');
  }
  
  // Encrypt API key before saving
  if (this.translationApiKey && !isEncrypted(this.translationApiKey)) {
    try {
      this.translationApiKeyEncrypted = encrypt(this.translationApiKey);
      this.translationApiKey = undefined; // Clear raw value from memory
    } catch (err: any) {
      console.warn('[LocaleConfig] Could not encrypt API key (ENCRYPTION_KEY may not be set):', err.message);
    }
  }

  next();
});

const LocaleConfig: Model<ILocaleConfig> = mongoose.model<ILocaleConfig>('LocaleConfig', LocaleConfigSchema);

export default LocaleConfig;
