import axios from 'axios';
import { ILocaleConfig } from '../models/LocaleConfig';

/**
 * Translation Service
 * Wraps Google Cloud Translation API v2
 */

// Curated 50 languages for web projects
export const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English', direction: 'ltr' },
    { code: 'es', name: 'Spanish', direction: 'ltr' },
    { code: 'zh', name: 'Chinese (Simplified)', direction: 'ltr' },
    { code: 'zh-TW', name: 'Chinese (Traditional)', direction: 'ltr' },
    { code: 'hi', name: 'Hindi', direction: 'ltr' },
    { code: 'ar', name: 'Arabic', direction: 'rtl' },
    { code: 'pt', name: 'Portuguese', direction: 'ltr' },
    { code: 'fr', name: 'French', direction: 'ltr' },
    { code: 'de', name: 'German', direction: 'ltr' },
    { code: 'ru', name: 'Russian', direction: 'ltr' },
    { code: 'ja', name: 'Japanese', direction: 'ltr' },
    { code: 'ko', name: 'Korean', direction: 'ltr' },
    { code: 'it', name: 'Italian', direction: 'ltr' },
    { code: 'nl', name: 'Dutch', direction: 'ltr' },
    { code: 'tr', name: 'Turkish', direction: 'ltr' },
    { code: 'pl', name: 'Polish', direction: 'ltr' },
    { code: 'sv', name: 'Swedish', direction: 'ltr' },
    { code: 'no', name: 'Norwegian', direction: 'ltr' },
    { code: 'da', name: 'Danish', direction: 'ltr' },
    { code: 'fi', name: 'Finnish', direction: 'ltr' },
    { code: 'cs', name: 'Czech', direction: 'ltr' },
    { code: 'ro', name: 'Romanian', direction: 'ltr' },
    { code: 'hu', name: 'Hungarian', direction: 'ltr' },
    { code: 'uk', name: 'Ukrainian', direction: 'ltr' },
    { code: 'el', name: 'Greek', direction: 'ltr' },
    { code: 'he', name: 'Hebrew', direction: 'rtl' },
    { code: 'fa', name: 'Persian (Farsi)', direction: 'rtl' },
    { code: 'ur', name: 'Urdu', direction: 'rtl' },
    { code: 'bn', name: 'Bengali', direction: 'ltr' },
    { code: 'id', name: 'Indonesian', direction: 'ltr' },
    { code: 'ms', name: 'Malay', direction: 'ltr' },
    { code: 'th', name: 'Thai', direction: 'ltr' },
    { code: 'vi', name: 'Vietnamese', direction: 'ltr' },
    { code: 'tl', name: 'Filipino', direction: 'ltr' },
    { code: 'sw', name: 'Swahili', direction: 'ltr' },
    { code: 'am', name: 'Amharic', direction: 'ltr' },
    { code: 'yo', name: 'Yoruba', direction: 'ltr' },
    { code: 'ha', name: 'Hausa', direction: 'ltr' },
    { code: 'sk', name: 'Slovak', direction: 'ltr' },
    { code: 'bg', name: 'Bulgarian', direction: 'ltr' },
    { code: 'hr', name: 'Croatian', direction: 'ltr' },
    { code: 'sr', name: 'Serbian', direction: 'ltr' },
    { code: 'lt', name: 'Lithuanian', direction: 'ltr' },
    { code: 'lv', name: 'Latvian', direction: 'ltr' },
    { code: 'et', name: 'Estonian', direction: 'ltr' },
    { code: 'sl', name: 'Slovenian', direction: 'ltr' },
    { code: 'af', name: 'Afrikaans', direction: 'ltr' },
    { code: 'ca', name: 'Catalan', direction: 'ltr' },
    { code: 'gu', name: 'Gujarati', direction: 'ltr' },
    { code: 'ta', name: 'Tamil', direction: 'ltr' }
];

class TranslationService {
    private readonly GOOGLE_API_URL = 'https://translation.googleapis.com/language/translate/v2';

    /**
     * Translate a single string
     */
    async translateText(
        text: string, 
        targetLang: string, 
        config: ILocaleConfig,
        sourceLang: string = 'en'
    ): Promise<string> {
        if (!text || targetLang === sourceLang) return text;
        if (!config.translationApiKey) {
            throw new Error('Translation API key missing for tenant');
        }

        // Check glossary first
        if (config.glossary && config.glossary[text]) {
            return config.glossary[text];
        }

        try {
            const response = await axios.post(`${this.GOOGLE_API_URL}?key=${config.translationApiKey}`, {
                q: text,
                target: targetLang,
                source: sourceLang,
                format: 'html' // Use HTML to preserve tags if content contains them
            });

            const translation = response.data.data.translations[0].translatedText;
            return translation;
        } catch (error: any) {
            console.error('Google Translation Error:', error.response?.data || error.message);
            throw new Error(`Translation failed: ${error.message}`);
        }
    }

    /**
     * Translate an object (the 'data' field of Content)
     */
    async translateObject(
        data: Record<string, any>,
        targetLang: string,
        config: ILocaleConfig,
        sourceLang: string = 'en'
    ): Promise<Record<string, any>> {
        const translated: Record<string, any> = { ...data };
        const fieldsToTranslate = config.autoTranslateFields || [];

        for (const field of fieldsToTranslate) {
            if (data[field] && typeof data[field] === 'string') {
                try {
                    translated[field] = await this.translateText(data[field], targetLang, config, sourceLang);
                } catch (error) {
                    console.warn(`Skipping translation for field ${field}:`, error);
                }
            } else if (data[field] && typeof data[field] === 'object' && !Array.isArray(data[field])) {
                // Nested translation if needed
                translated[field] = await this.translateObject(data[field], targetLang, config, sourceLang);
            }
        }

        return translated;
    }

    /**
     * Detect language (Optional, for future use)
     */
    async detectLanguage(text: string, apiKey: string): Promise<string> {
        try {
            const response = await axios.post(`https://translation.googleapis.com/language/translate/v2/detect?key=${apiKey}`, {
                q: text
            });
            return response.data.data.detections[0][0].language;
        } catch (error) {
            return 'en';
        }
    }
}

export default new TranslationService();
