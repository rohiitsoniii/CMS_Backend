/**
 * AI Service
 * 
 * Provides AI-powered features:
 * - Content generation
 * - Auto-tagging
 * - SEO optimization
 * - Translation
 * - Image alt text generation
 */

import { aiGateway } from './aiGateway.js';

/**
 * Feature layer: prompts for each AI capability. Provider selection (BYOK vs
 * platform credits), quota enforcement and metering live in aiGateway.
 */
class AIService {
  /**
   * Generate content based on a prompt
   */
  async generateContent(prompt: string, options?: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }): Promise<string> {
    return aiGateway.chat(prompt, {
      maxTokens: options?.maxTokens,
      temperature: options?.temperature ?? 0.7,
      model: options?.model,
    });
  }

  /**
   * Generate blog post
   */
  async generateBlogPost(topic: string, keywords?: string[]): Promise<{
    title: string;
    excerpt: string;
    content: string;
    tags: string[];
  }> {
    const keywordText = keywords?.length ? `Include these keywords: ${keywords.join(', ')}` : '';
    
    const prompt = `Write a comprehensive blog post about "${topic}". ${keywordText}

Please provide:
1. A catchy title
2. A brief excerpt (2-3 sentences)
3. Full blog post content (500-800 words)
4. 5 relevant tags

Format your response as JSON:
{
  "title": "...",
  "excerpt": "...",
  "content": "...",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`;

    const response = await this.generateContent(prompt, { maxTokens: 2000 });
    
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Invalid response format');
    } catch (error) {
      throw new Error('Failed to parse AI response');
    }
  }

  /**
   * Generate product description
   */
  async generateProductDescription(productName: string, features: string[]): Promise<string> {
    const prompt = `Write a compelling product description for "${productName}".

Features:
${features.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Write a 2-3 paragraph description that highlights the benefits and appeals to customers.`;

    return this.generateContent(prompt, { maxTokens: 500 });
  }

  /**
   * Auto-generate tags for content
   */
  async generateTags(content: string, maxTags: number = 5): Promise<string[]> {
    const prompt = `Analyze this content and suggest ${maxTags} relevant tags/keywords:

"${content.substring(0, 500)}..."

Respond with ONLY a comma-separated list of tags, nothing else.`;

    const response = await this.generateContent(prompt, { maxTokens: 100, temperature: 0.5 });
    
    return response
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
      .slice(0, maxTags);
  }

  /**
   * Generate SEO meta description
   */
  async generateMetaDescription(title: string, content: string): Promise<string> {
    const prompt = `Create an SEO-optimized meta description (150-160 characters) for this content:

Title: ${title}
Content: ${content.substring(0, 300)}...

Respond with ONLY the meta description, nothing else.`;

    const response = await this.generateContent(prompt, { maxTokens: 100, temperature: 0.5 });
    
    return response.trim().substring(0, 160);
  }

  /**
   * Generate SEO title
   */
  async generateSEOTitle(content: string): Promise<string> {
    const prompt = `Create an SEO-optimized title (50-60 characters) for this content:

${content.substring(0, 300)}...

Respond with ONLY the title, nothing else.`;

    const response = await this.generateContent(prompt, { maxTokens: 50, temperature: 0.5 });
    
    return response.trim().substring(0, 60);
  }

  /**
   * Generate image alt text
   */
  async generateImageAltText(imageName: string, context?: string): Promise<string> {
    const contextText = context ? `Context: ${context}` : '';
    
    const prompt = `Generate descriptive alt text for an image named "${imageName}". ${contextText}

The alt text should be:
- Descriptive and specific
- 125 characters or less
- Helpful for screen readers
- SEO-friendly

Respond with ONLY the alt text, nothing else.`;

    const response = await this.generateContent(prompt, { maxTokens: 50, temperature: 0.5 });
    
    return response.trim().substring(0, 125);
  }

  /**
   * Translate content
   */
  async translateContent(content: string, targetLanguage: string): Promise<string> {
    const prompt = `Translate the following content to ${targetLanguage}. Maintain the tone and style:

${content}

Respond with ONLY the translation, nothing else.`;

    return this.generateContent(prompt, { maxTokens: content.length * 2 });
  }

  /**
   * Improve content (grammar, style, clarity)
   */
  async improveContent(content: string): Promise<string> {
    const prompt = `Improve the following content by:
- Fixing grammar and spelling
- Improving clarity and readability
- Enhancing style and flow
- Keeping the same meaning and tone

Content:
${content}

Respond with ONLY the improved content, nothing else.`;

    return this.generateContent(prompt, { maxTokens: content.length * 2 });
  }

  /**
   * Generate content outline
   */
  async generateOutline(topic: string): Promise<string[]> {
    const prompt = `Create a detailed outline for content about "${topic}".

Provide 5-7 main sections with brief descriptions.

Format as a numbered list.`;

    const response = await this.generateContent(prompt, { maxTokens: 500 });
    
    return response
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.replace(/^\d+\.\s*/, '').trim());
  }

  /**
   * Analyze content sentiment
   */
  async analyzeSentiment(content: string): Promise<{
    sentiment: 'positive' | 'negative' | 'neutral';
    score: number;
    summary: string;
  }> {
    const prompt = `Analyze the sentiment of this content:

"${content.substring(0, 500)}..."

Respond in JSON format:
{
  "sentiment": "positive|negative|neutral",
  "score": 0.0-1.0,
  "summary": "brief explanation"
}`;

    const response = await this.generateContent(prompt, { maxTokens: 200, temperature: 0.3 });
    
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Invalid response format');
    } catch (error) {
      return {
        sentiment: 'neutral',
        score: 0.5,
        summary: 'Unable to analyze sentiment',
      };
    }
  }

  /**
   * Generate FAQ from content
   */
  async generateFAQ(content: string, numQuestions: number = 5): Promise<Array<{
    question: string;
    answer: string;
  }>> {
    const prompt = `Based on this content, generate ${numQuestions} frequently asked questions with answers:

${content.substring(0, 1000)}...

Format as JSON array:
[
  {"question": "...", "answer": "..."},
  ...
]`;

    const response = await this.generateContent(prompt, { maxTokens: 1000 });
    
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Invalid response format');
    } catch (error) {
      return [];
    }
  }

  /**
   * Generate Content Type Schema (Fields) from a prompt
   */
  async generateSchema(promptText: string): Promise<any[]> {
    const prompt = `You are a Headless CMS schema expert. Generate a list of fields for a Content Type described as: "${promptText}".

Available Field Types: text, number, boolean, datetime, richText, markdown, select, media, reference, slug, email, url, color, location, json.

For each field, provide:
1. name (camelCase, e.g., "jobTitle")
2. displayName (Human readable, e.g., "Job Title")
3. type (one of the available types above)
4. required (boolean)
5. helpText (brief string)

Format your response as a JSON array of objects. Do not include any other text.
Example:
[
  {"name": "title", "displayName": "Title", "type": "text", "required": true, "helpText": "Enter the main title"},
  ...
]`;

    const response = await this.generateContent(prompt, { maxTokens: 1500, temperature: 0.4 });

    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Invalid response format');
    } catch (error) {
      console.error('AI Schema Generation Parsing Error:', error);
      throw new Error('Failed to parse AI-generated schema');
    }
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY);
  }

  /**
   * Check availability for the current tenant (their own key or platform credits)
   */
  async availability() {
    return aiGateway.isAvailable();
  }

  /**
   * Generate email content
   */
  async generateEmail(topic: string, type: 'newsletter' | 'welcome' | 'promo', context?: string): Promise<{
    subject: string;
    preheader: string;
    content: string;
  }> {
    const typePrompts = {
      newsletter: 'an engaging newsletter',
      welcome: 'a warm welcome email',
      promo: 'a persuasive promotional email',
    };

    const prompt = `Write ${typePrompts[type]} about "${topic}". ${context ? `Context: ${context}` : ''}

Please provide:
1. A compelling Subject Line
2. A Preheader text (preview text)
3. The email body content (HTML format with basic styling)

Format your response as JSON:
{
  "subject": "...",
  "preheader": "...",
  "content": "..."
}`;

    const response = await this.generateContent(prompt, { maxTokens: 1500 });

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Invalid response format');
    } catch (error) {
      throw new Error('Failed to parse AI response');
    }
  }

  /**
   * Suggest high-potential keywords based on project topic and existing content
   */
  async suggestKeywords(topic: string, context: string, count: number = 10): Promise<Array<{
    keyword: string;
    intent: 'informational' | 'transactional' | 'navigational' | 'commercial';
    difficulty: 'high' | 'medium' | 'low';
  }>> {
    const prompt = `Act as an SEO expert. Suggest ${count} high-potential keywords for a website about "${topic}".
    
    Site Context: ${context.substring(0, 500)}...
    
    For each keyword, determine:
    1. Search Intent (informational, transactional, navigational, commercial)
    2. Estimated Difficulty (high, medium, low)
    
    Format as JSON array:
    [
      {"keyword": "...", "intent": "...", "difficulty": "..."}
    ]`;

    const response = await this.generateContent(prompt, { maxTokens: 1000, temperature: 0.6 });
    
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]).slice(0, count);
      }
      throw new Error('Invalid response format');
    } catch (error) {
      return [];
    }
  }

  /**
   * Suggest backlink opportunities and outreach strategy
   */
  async suggestBacklinkOpportunities(topic: string): Promise<Array<{
    siteType: string;
    strategy: string;
    exampleSites: string[];
  }>> {
    const prompt = `Suggest backlink building opportunities for a website focusing on "${topic}".
    
    Provide 5 distinct strategies/site types.
    
    Format as JSON array:
    [
      {
        "siteType": "Industry Blogs",
        "strategy": "Guest posting about trend X...",
        "exampleSites": ["site1.com", "site2.com"]
      }
    ]`;

    const response = await this.generateContent(prompt, { maxTokens: 1000 });
    
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Invalid response format');
    } catch (error) {
      return [];
    }
  }

  /**
   * Get available models
   */
  getAvailableModels(): string[] {
    return [
      'meta-llama/llama-3.2-3b-instruct:free',
      'meta-llama/llama-3.2-1b-instruct:free',
      'google/gemma-2-9b-it:free',
      'microsoft/phi-3-mini-128k-instruct:free',
      'mistralai/mistral-7b-instruct:free',
    ];
  }
}

export default new AIService();
