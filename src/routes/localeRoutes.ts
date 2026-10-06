import express from 'express';
import {
  getLocaleConfig,
  updateLocaleConfig,
  addLocale,
  updateLocale,
  removeLocale,
  getEnabledLocales,
  getSupportedLanguages,
  updateTranslationApiKey,
  translateContent,
  translateAllContent
} from '../controllers/localeController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

/**
 * Locale Configuration Routes
 * All routes require authentication
 */

// Get locale configuration
router.get('/', authenticateJWT, getLocaleConfig);

// Update locale configuration
router.put('/', authenticateJWT, updateLocaleConfig);

// Get curated list of languages
router.get('/supported-languages', authenticateJWT, getSupportedLanguages);

// Get enabled locales
router.get('/enabled', authenticateJWT, getEnabledLocales);

// Add new locale
router.post('/add', authenticateJWT, addLocale);

// Update translation API key
router.put('/api-key', authenticateJWT, updateTranslationApiKey);

// Translate specific content
router.post('/translate-content/:id', authenticateJWT, translateContent);

// Translate all content
router.post('/translate-all', authenticateJWT, translateAllContent);

// Update locale
router.put('/:code', authenticateJWT, updateLocale);

// Remove locale
router.delete('/:code', authenticateJWT, removeLocale);

export default router;
