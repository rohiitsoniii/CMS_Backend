/**
 * AI Controller
 * 
 * Handles AI-powered features via REST API
 */

import { Request, Response, NextFunction } from 'express';
import aiService from '../services/aiService';
import { asyncHandler } from '../middleware';

/**
 * Generate blog post
 */
export const generateBlogPost = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { topic, keywords } = req.body;

  if (!topic) {
    res.status(400).json({
      success: false,
      message: 'Topic is required',
    }); return;
  }

  const result = await aiService.generateBlogPost(topic, keywords);

  res.json({
    success: true,
    data: result,
  });
});

/**
 * Generate product description
 */
export const generateProductDescription = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { productName, features } = req.body;

  if (!productName || !features) {
    res.status(400).json({
      success: false,
      message: 'Product name and features are required',
    }); return;
  }

  const description = await aiService.generateProductDescription(productName, features);

  res.json({
    success: true,
    data: { description },
  });
});

/**
 * Generate tags
 */
export const generateTags = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { content, maxTags = 5 } = req.body;

  if (!content) {
    res.status(400).json({
      success: false,
      message: 'Content is required',
    }); return;
  }

  const tags = await aiService.generateTags(content, maxTags);

  res.json({
    success: true,
    data: { tags },
  });
});

/**
 * Generate SEO meta description
 */
export const generateMetaDescription = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { title, content } = req.body;

  if (!title || !content) {
    res.status(400).json({
      success: false,
      message: 'Title and content are required',
    }); return;
  }

  const metaDescription = await aiService.generateMetaDescription(title, content);

  res.json({
    success: true,
    data: { metaDescription },
  });
});

/**
 * Generate SEO title
 */
export const generateSEOTitle = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { content } = req.body;

  if (!content) {
    res.status(400).json({
      success: false,
      message: 'Content is required',
    }); return;
  }

  const title = await aiService.generateSEOTitle(content);

  res.json({
    success: true,
    data: { title },
  });
});

/**
 * Generate image alt text
 */
export const generateImageAltText = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { imageName, context } = req.body;

  if (!imageName) {
    res.status(400).json({
      success: false,
      message: 'Image name is required',
    }); return;
  }

  const altText = await aiService.generateImageAltText(imageName, context);

  res.json({
    success: true,
    data: { altText },
  });
});

/**
 * Translate content
 */
export const translateContent = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { content, targetLanguage } = req.body;

  if (!content || !targetLanguage) {
    res.status(400).json({
      success: false,
      message: 'Content and target language are required',
    }); return;
  }

  const translation = await aiService.translateContent(content, targetLanguage);

  res.json({
    success: true,
    data: { translation },
  });
});

/**
 * Improve content
 */
export const improveContent = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { content } = req.body;

  if (!content) {
    res.status(400).json({
      success: false,
      message: 'Content is required',
    }); return;
  }

  const improvedContent = await aiService.improveContent(content);

  res.json({
    success: true,
    data: { improvedContent },
  });
});

/**
 * Generate outline
 */
export const generateOutline = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { topic } = req.body;

  if (!topic) {
    res.status(400).json({
      success: false,
      message: 'Topic is required',
    }); return;
  }

  const outline = await aiService.generateOutline(topic);

  res.json({
    success: true,
    data: { outline },
  });
});

/**
 * Analyze sentiment
 */
export const analyzeSentiment = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { content } = req.body;

  if (!content) {
    res.status(400).json({
      success: false,
      message: 'Content is required',
    }); return;
  }

  const sentiment = await aiService.analyzeSentiment(content);

  res.json({
    success: true,
    data: sentiment,
  });
});

/**
 * Generate FAQ
 */
export const generateFAQ = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { content, numQuestions = 5 } = req.body;

  if (!content) {
    res.status(400).json({
      success: false,
      message: 'Content is required',
    }); return;
  }

  const faq = await aiService.generateFAQ(content, numQuestions);

  res.json({
    success: true,
    data: { faq },
  });
});

/**
 * Generate email
 */
export const generateEmail = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { topic, type = 'newsletter', context } = req.body;

  if (!topic) {
    res.status(400).json({
      success: false,
      message: 'Topic is required',
    }); return;
  }

  const result = await aiService.generateEmail(topic, type, context);

  res.json({
    success: true,
    data: result,
  });
});

/**
 * Generate content type schema
 */
export const generateSchema = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const { prompt } = req.body;

  if (!prompt) {
    res.status(400).json({
      success: false,
      message: 'Prompt is required',
    }); return;
  }

  const fields = await aiService.generateSchema(prompt);

  res.json({
    success: true,
    data: { fields },
  });
});


/**
 * Get AI service status
 */
export const getAIStatus = asyncHandler(async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
  const availability = await aiService.availability();
  const availableModels = aiService.getAvailableModels();

  res.json({
    success: true,
    data: {
      configured: availability.available,
      keySource: availability.keySource,
      provider: availability.provider || null,
      availableModels,
    },
  });
});
