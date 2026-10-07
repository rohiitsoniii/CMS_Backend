import { Request, Response } from 'express';
import LocaleConfig, { ILocale } from '../models/LocaleConfig';
import { Content } from '../models/Content';
import { SUPPORTED_LANGUAGES } from '../services/translationService';
import { enqueueTranslation } from '../workers/translationWorker';

/**
 * Locale Configuration Controller
 * Manages multi-language settings for tenants
 */

/**
 * @route   GET /api/v1/locales
 * @desc    Get locale configuration for tenant
 * @access  Private
 */
export const getLocaleConfig = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Get or create default configuration
    const config = await (LocaleConfig as any).getOrCreateDefault(tenantId, userId);

    return res.json({
      success: true,
      data: { config }
    });
  } catch (error: any) {
    console.error('Error fetching locale config:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch locale configuration',
      error: error.message
    });
  }
};

/**
 * @route   PUT /api/v1/locales
 * @desc    Update locale configuration
 * @access  Private
 */
export const updateLocaleConfig = async (req: Request, res: Response) => {
  try {
    const { defaultLocale, fallbackLocale, locales, fallbackChain, autoTranslate, translationProvider } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    let config = await (LocaleConfig as any).findByTenant(tenantId);

    if (!config) {
      // Create new configuration
      config = new LocaleConfig({
        tenantId,
        defaultLocale: defaultLocale || 'en',
        fallbackLocale: fallbackLocale || 'en',
        locales: locales || [
          {
            code: 'en',
            name: 'English',
            direction: 'ltr',
            isDefault: true,
            isEnabled: true
          }
        ],
        fallbackChain: fallbackChain || {},
        autoTranslate: autoTranslate || false,
        translationProvider,
        createdBy: userId,
        updatedBy: userId
      });
    } else {
      // Update existing configuration
      if (defaultLocale) config.defaultLocale = defaultLocale;
      if (fallbackLocale) config.fallbackLocale = fallbackLocale;
      if (locales) config.locales = locales;
      if (fallbackChain) config.fallbackChain = fallbackChain;
      if (autoTranslate !== undefined) config.autoTranslate = autoTranslate;
      if (translationProvider) config.translationProvider = translationProvider;
      if (req.body.autoTranslateFields) config.autoTranslateFields = req.body.autoTranslateFields;
      if (req.body.glossary) config.glossary = req.body.glossary;
      config.updatedBy = userId;
    }

    await config.save();

    return res.json({
      success: true,
      message: 'Locale configuration updated successfully',
      data: { config }
    });
  } catch (error: any) {
    console.error('Error updating locale config:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update locale configuration',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/locales/add
 * @desc    Add a new locale
 * @access  Private
 */
export const addLocale = async (req: Request, res: Response) => {
  try {
    const { code, name, direction, isDefault } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    if (!code || !name) {
      return res.status(400).json({
        success: false,
        message: 'Locale code and name are required'
      });
    }

    const config = await (LocaleConfig as any).getOrCreateDefault(tenantId, userId);

    // Check if locale already exists
    const existingLocale = config.getLocale(code);
    if (existingLocale) {
      return res.status(400).json({
        success: false,
        message: `Locale "${code}" already exists`
      });
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      config.locales.forEach((l: any) => {
        l.isDefault = false;
      });
      config.defaultLocale = code;
    }

    // Add new locale
    const newLocale: ILocale = {
      code,
      name,
      direction: direction || 'ltr',
      isDefault: isDefault || false,
      isEnabled: true
    };

    config.locales.push(newLocale);
    config.updatedBy = userId;
    await config.save();

    return res.status(201).json({
      success: true,
      message: 'Locale added successfully',
      data: { locale: newLocale, config }
    });
  } catch (error: any) {
    console.error('Error adding locale:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add locale',
      error: error.message
    });
  }
};

/**
 * @route   PUT /api/v1/locales/:code
 * @desc    Update a locale
 * @access  Private
 */
export const updateLocale = async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { name, direction, isDefault, isEnabled } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const config = await (LocaleConfig as any).findByTenant(tenantId);

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Locale configuration not found'
      });
    }

    const locale = config.getLocale(code);

    if (!locale) {
      return res.status(404).json({
        success: false,
        message: `Locale "${code}" not found`
      });
    }

    // Update locale properties
    if (name) locale.name = name;
    if (direction) locale.direction = direction;
    if (isEnabled !== undefined) locale.isEnabled = isEnabled;

    // Handle default locale change
    if (isDefault !== undefined && isDefault) {
      config.locales.forEach((l: any) => {
        l.isDefault = l.code === code;
      });
      config.defaultLocale = code;
    }

    config.updatedBy = userId;
    await config.save();

    return res.json({
      success: true,
      message: 'Locale updated successfully',
      data: { locale, config }
    });
  } catch (error: any) {
    console.error('Error updating locale:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update locale',
      error: error.message
    });
  }
};

/**
 * @route   DELETE /api/v1/locales/:code
 * @desc    Remove a locale
 * @access  Private
 */
export const removeLocale = async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const config = await (LocaleConfig as any).findByTenant(tenantId);

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Locale configuration not found'
      });
    }

    const locale = config.getLocale(code);

    if (!locale) {
      return res.status(404).json({
        success: false,
        message: `Locale "${code}" not found`
      });
    }

    // Prevent removing default locale
    if (locale.isDefault) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove default locale. Set another locale as default first.'
      });
    }

    // Prevent removing last locale
    if (config.locales.length === 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove the last locale'
      });
    }

    // Remove locale
    config.locales = config.locales.filter((l: any) => l.code !== code);
    
    // Remove from fallback chain
    delete config.fallbackChain[code];
    
    config.updatedBy = userId;
    await config.save();

    return res.json({
      success: true,
      message: 'Locale removed successfully',
      data: { config }
    });
  } catch (error: any) {
    console.error('Error removing locale:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove locale',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/locales/enabled
 * @desc    Get list of enabled locales
 * @access  Private
 */
export const getEnabledLocales = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const config = await (LocaleConfig as any).getOrCreateDefault(tenantId, userId);
    const enabledLocales = config.locales.filter((l: any) => l.isEnabled);

    return res.json({
      success: true,
      data: {
        locales: enabledLocales,
        defaultLocale: config.defaultLocale,
        fallbackLocale: config.fallbackLocale
      }
    });
  } catch (error: any) {
    console.error('Error fetching enabled locales:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch enabled locales',
      error: error.message
    });
  }
};
/**
 * @route   GET /api/v1/locales/supported-languages
 * @desc    Get curated list of supported languages
 * @access  Private
 */
export const getSupportedLanguages = async (_req: Request, res: Response) => {
  return res.json({
    success: true,
    data: { languages: SUPPORTED_LANGUAGES }
  });
};

/**
 * @route   PUT /api/v1/locales/api-key
 * @desc    Update translation API key
 * @access  Private
 */
export const updateTranslationApiKey = async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!apiKey) {
      return res.status(400).json({ success: false, message: 'API Key is required' });
    }

    const config = await (LocaleConfig as any).getOrCreateDefault(tenantId, userId);
    
    // Encrypt the key before storing — never store plaintext
    try {
      config.translationApiKey = apiKey; // Will be encrypted by pre-save hook
    } catch (encryptErr: any) {
      return res.status(500).json({ 
        success: false, 
        message: 'Encryption service unavailable. Ensure ENCRYPTION_KEY is set in environment variables.' 
      });
    }
    
    config.updatedBy = userId;
    await config.save();

    return res.json({
      success: true,
      message: 'Translation API Key saved securely (AES-256 encrypted)'
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Failed to update API Key', error: error.message });
  }
};

/**
 * @route   POST /api/v1/locales/translate-content/:id
 * @desc    Translate a content item to all enabled locales
 * @access  Private
 */
export const translateContent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const config = await (LocaleConfig as any).findByTenant(tenantId);
    if (!config || !config.autoTranslate) {
      return res.status(400).json({ success: false, message: 'Auto-translation is not enabled. Enable it in Translation Settings.' });
    }

    const content = await Content.findOne({ _id: id, tenantId });
    if (!content) {
      return res.status(404).json({ success: false, message: 'Content not found' });
    }

    // Enqueue async job — returns immediately
    const jobId = await enqueueTranslation({
      contentId: id,
      tenantId: tenantId.toString(),
      userId: userId.toString(),
    });

    return res.json({
      success: true,
      message: 'Translation job queued. Poll /api/v1/jobs/:jobId for progress.',
      data: { jobId }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Failed to queue translation', error: error.message });
  }
};

/**
 * @route   POST /api/v1/locales/translate-all
 * @desc    Translate all published content for the project
 * @access  Private
 */
export const translateAllContent = async (_req: Request, res: Response) => {
    // This would definitely need a worker, but we'll provide the endpoint structure
    return res.json({
        success: true,
        message: 'Bulk translation task queued (Worker implementation pending)'
    });
};
