import { IContent } from '../models/Content';
import { ISeoIssue } from '../models/SeoReport';

export class SeoAnalysisService {
  /**
   * Performs real-time SEO analysis on a content object
   */
  public static analyzeContent(content: IContent, focusKeywords: string[]): {
    score: number;
    issues: ISeoIssue[];
    readabilityScore: number;
  } {
    const issues: ISeoIssue[] = [];
    let score = 100;

    const data = content.data as Record<string, any>;
    const seo = content.seo || {};
    
    // 1. Meta Title Analysis
    const metaTitle = seo.metaTitle || content.name;
    if (!metaTitle) {
      issues.push({ type: 'error', field: 'metaTitle', message: 'Missing Meta Title', recommendation: 'Add a title between 50-60 characters.' });
      score -= 20;
    } else {
      if (metaTitle.length < 30) {
        issues.push({ type: 'warning', field: 'metaTitle', message: 'Title is too short', recommendation: 'Target 50-60 characters for best visibility.' });
        score -= 5;
      } else if (metaTitle.length > 60) {
        issues.push({ type: 'warning', field: 'metaTitle', message: 'Title is too long', recommendation: 'Titles over 60 characters may be truncated in Search results.' });
        score -= 5;
      }
      
      // Check if focus keyword in title
      if (focusKeywords.length > 0) {
        const keywordFound = focusKeywords.some(kw => metaTitle.toLowerCase().includes(kw.toLowerCase()));
        if (!keywordFound) {
          issues.push({ type: 'error', field: 'metaTitle', message: 'Focus keyword not in Title', recommendation: `Try to include "${focusKeywords[0]}" in your meta title.` });
          score -= 10;
        }
      }
    }

    // 2. Meta Description Analysis
    const metaDesc = seo.metaDescription;
    if (!metaDesc) {
      issues.push({ type: 'error', field: 'metaDescription', message: 'Missing Meta Description', recommendation: 'Add a description between 150-165 characters.' });
      score -= 15;
    } else {
      if (metaDesc.length < 120) {
        issues.push({ type: 'warning', field: 'metaDescription', message: 'Description is too short', recommendation: 'Expand to 150-165 characters for better CTR.' });
        score -= 5;
      } else if (metaDesc.length > 165) {
        issues.push({ type: 'warning', field: 'metaDescription', message: 'Description is too long', recommendation: 'Descriptions over 165 characters are truncated.' });
        score -= 5;
      }
      
      // Focus keyword in desc
      if (focusKeywords.length > 0) {
        const keywordFound = focusKeywords.some(kw => metaDesc.toLowerCase().includes(kw.toLowerCase()));
        if (!keywordFound) {
          issues.push({ type: 'warning', field: 'metaDescription', message: 'Focus keyword not in Meta Description', recommendation: 'Google highlights keywords in descriptions.' });
          score -= 5;
        }
      }
    }

    // 3. Content Body Analysis (assuming 'body' or 'content' field exists in data)
    const contentBody = (data.body || data.content || data.text || '') as string;
    const bodyText = contentBody.replace(/<[^>]*>?/gm, ''); // Strip HTML
    const wordCount = bodyText.trim().split(/\s+/).length;

    if (wordCount < 300 && ['blog', 'page'].includes(content.type)) {
      issues.push({ type: 'warning', field: 'body', message: 'Thin Content', recommendation: 'Articles should be at least 300 words for better ranking.' });
      score -= 10;
    }

    // 4. Heading Hierarchy
    const h1Count = (contentBody.match(/<h1/g) || []).length;
    if (h1Count > 1) {
      issues.push({ type: 'error', field: 'body', message: 'Multiple H1 Tags', recommendation: 'Use only one H1 per page for proper hierarchy.' });
      score -= 10;
    } else if (h1Count === 0 && !['header', 'footer'].includes(content.type)) {
       // Note: Name might be H1 in frontend, but if not found in body, alert anyway
       issues.push({ type: 'info', field: 'body', message: 'Missing H1 in Body', recommendation: 'Ensure your theme renders the title as an H1.' });
    }

    // 5. Image Alt Text
    const images = contentBody.match(/<img/g) || [];
    const missingAlt = (contentBody.match(/<img(?![^>]*\balt=)[^>]*>/g) || []).length;
    if (images.length > 0 && missingAlt > 0) {
      issues.push({ type: 'warning', field: 'body', message: `${missingAlt} images missing Alt text`, recommendation: 'Add alt attributes to all images for accessibility and SEO.' });
      score -= 5;
    }

    // 6. Focus Keyword Density
    if (focusKeywords.length > 0 && wordCount > 100) {
      const mainKeyword = focusKeywords[0].toLowerCase();
      const occurrences = (bodyText.toLowerCase().match(new RegExp(mainKeyword, 'g')) || []).length;
      const density = (occurrences / wordCount) * 100;

      if (density < 0.5) {
        issues.push({ type: 'info', field: 'body', message: 'Low Keyword Density', recommendation: `Include "${mainKeyword}" more naturally in the text.` });
        score -= 2;
      } else if (density > 3) {
        issues.push({ type: 'warning', field: 'body', message: 'Keyword Stuffing?', recommendation: `Density of "${mainKeyword}" is ${density.toFixed(1)}%. Consider reducing.` });
        score -= 5;
      }
    }

    // 7. OG Image
    if (!seo.ogImage?.url) {
      issues.push({ type: 'info', field: 'ogImage', message: 'Missing Social Share Image', recommendation: 'Set an OG Image for better social media appearance.' });
    }

    // 8. Locales
    if (content.locale !== 'en' && !content.localizedData?.[content.locale]) {
       // Potential translation gap
    }

    return {
      score: Math.max(0, score),
      issues,
      readabilityScore: this.calculateReadability(bodyText),
    };
  }

  /**
   * Simple Flesch-Kincaid implementation or similar heuristic
   */
  private static calculateReadability(text: string): number {
    if (!text || text.length < 50) return 0;
    
    const words = text.split(/\s+/).length;
    const sentences = (text.match(/[.!?]/g) || []).length || 1;
    const syllables = this.countSyllables(text);
    
    // Flesch Reading Ease Formula
    const score = 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllables / words));
    return Math.min(100, Math.max(0, Math.round(score)));
  }

  private static countSyllables(text: string): number {
    text = text.toLowerCase();
    if (text.length <= 3) return 1;
    text = text.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    text = text.replace(/^y/, '');
    const res = text.match(/[aeiouy]{1,2}/g);
    return res ? res.length : 1;
  }
}
