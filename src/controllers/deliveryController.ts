import { Request, Response } from 'express';
import { Content, Project, Knowledge, ContentTypes, ContentType as ContentTypeModel } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { analyticsService } from '../services/analyticsService.js';
import type { ContentType } from '../models/Content.js';


/**
 * Public Delivery API
 * These endpoints are called by the frontend website/app
 * They return only PUBLISHED content
 * Cached at the CDN level
 */

/**
 * Get all active content for a project
 * GET /api/v1/deliver/:projectSlug/all
 */
export const getAllContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectSlug } = req.params;
  const { locale, lang } = req.query;
  const requestedLocale = (lang || locale) as string;
  
  // Find project by slug
  const project = await Project.findOne({
    slug: projectSlug,
    tenantId: req.tenantId,
    status: 'active',
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  // Get all default, published content
  const contents = await Content.find({
    projectId: project._id,
    isDefault: true,
    status: 'published',
    isDeleted: false,
  }).select('type name data locale localizedData seo -_id');
  
  // Build response object by type
  const response: Record<string, unknown> = {};
  
  for (const content of contents) {
    // Get localized data if available
    const contentData = requestedLocale && content.localizedData?.[requestedLocale]
      ? { ...content.data, ...content.localizedData[requestedLocale] }
      : content.data;
    
    response[content.type] = {
      name: content.name,
      data: contentData,
      seo: content.seo,
    };
  }
  
  // Add project branding
  response.branding = project.branding;
  response.settings = {
    locale: requestedLocale || project.settings.defaultLocale || 'en',
    locales: project.settings.locales,
  };
  
  // Set cache headers
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
  
  res.json({
    success: true,
    data: response,
  });
});

/**
 * Get default header
 * GET /api/v1/deliver/:projectSlug/header
 */
export const getDefaultContent = (contentType: ContentType) => {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { projectSlug } = req.params;
    const { locale, lang } = req.query;
    const requestedLocale = (lang || locale) as string;
    
    const project = await Project.findOne({
      slug: projectSlug,
      tenantId: req.tenantId,
      status: 'active',
    });
    
    if (!project) {
      throw new AppError('Project not found', 404);
    }
    
    const content = await Content.findOne({
      projectId: project._id,
      type: contentType,
      isDefault: true,
      status: 'published',
      isDeleted: false,
    }).select('name data locale localizedData seo');
    
    if (!content) {
      // Return empty data instead of error
      res.set('Cache-Control', 'public, max-age=60');
      res.json({
        success: true,
        data: null,
      });
      return;
    }
    
    // Get localized data
    const contentData = requestedLocale && content.localizedData?.[requestedLocale]
      ? { ...content.data, ...content.localizedData[requestedLocale] }
      : content.data;
    
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
    
    res.json({
      success: true,
      data: {
        name: content.name,
        data: contentData,
        seo: content.seo,
      },
    });
  });
};

/**
 * Get blogs list
 * GET /api/v1/deliver/:projectSlug/blogs
 */
export const getBlogs = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectSlug } = req.params;
  const { locale, lang, page = 1, limit = 10, category, tag, featured } = req.query;
  const requestedLocale = (lang || locale) as string;
  
  const project = await Project.findOne({
    slug: projectSlug,
    tenantId: req.tenantId,
    status: 'active',
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  const query: Record<string, unknown> = {
    projectId: project._id,
    type: ContentTypes.BLOG,
    status: 'published',
    visibility: 'public',
    isDeleted: false,
  };
  
  if (category && typeof category === 'string') query['meta.category'] = category.slice(0, 100);
  if (tag && typeof tag === 'string') query['meta.tags'] = tag.slice(0, 100);
  if (featured === 'true') query['meta.featured'] = true;

  const safePage = Math.max(1, Math.floor(Number(page)) || 1);
  const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit)) || 10));
  const skip = (safePage - 1) * safeLimit;

  const [blogs, total] = await Promise.all([
    Content.find(query)
      .sort({ 'meta.publishedAt': -1, 'meta.pinned': -1 })
      .skip(skip)
      .limit(safeLimit)
      .select('name slug data.title data.excerpt data.featuredImage localizedData meta.publishedAt meta.readTime meta.category meta.tags seo'),
    Content.countDocuments(query),
  ]);
  
  // Format response
  const formattedBlogs = blogs.map(blog => {
    // Merge localized data for list view preview fields
    const displayData = requestedLocale && blog.localizedData?.[requestedLocale]
      ? { ...blog.data, ...blog.localizedData[requestedLocale] }
      : blog.data;

    return {
      slug: blog.slug,
      title: displayData.title || blog.name,
      excerpt: displayData.excerpt,
      featuredImage: displayData.featuredImage,
      publishedAt: blog.meta.publishedAt,
      readTime: blog.meta.readTime,
      category: blog.meta.category,
      tags: blog.meta.tags,
    };
  });
  
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
  
  res.json({
    success: true,
    data: {
      blogs: formattedBlogs,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    },
  });
});

/**
 * Get single blog by slug
 * GET /api/v1/deliver/:projectSlug/blogs/:slug
 */
export const getBlogBySlug = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectSlug, slug } = req.params;
  const { locale, lang } = req.query;
  const requestedLocale = (lang || locale) as string;
  
  const project = await Project.findOne({
    slug: projectSlug,
    tenantId: req.tenantId,
    status: 'active',
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  const blog = await Content.findOne({
    projectId: project._id,
    type: ContentTypes.BLOG,
    slug,
    status: 'published',
    visibility: 'public',
    isDeleted: false,
  }).populate('meta.author', 'firstName lastName');
  
  if (!blog) {
    throw new AppError('Blog not found', 404);
  }
  
  // Phase 6: Track Content Insight
  analyticsService.trackEvent({
    tenantId: project.tenantId.toString(),
    type: 'content_operation',
    category: 'delivery',
    action: 'view',
    projectId: project._id.toString(),
    metadata: {
      contentId: blog._id.toString(),
      contentType: ContentTypes.BLOG,
      slug: blog.slug
    }
  }).catch(err => console.error('Analytics Error:', err));
  
  // Get localized data

  const contentData = requestedLocale && blog.localizedData?.[requestedLocale]
    ? { ...blog.data, ...blog.localizedData[requestedLocale] }
    : blog.data;
  
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  
  res.json({
    success: true,
    data: {
      slug: blog.slug,
      title: contentData.title || blog.name,
      content: contentData.content,
      featuredImage: contentData.featuredImage,
      author: blog.meta.author,
      publishedAt: blog.meta.publishedAt,
      readTime: blog.meta.readTime,
      category: blog.meta.category,
      tags: blog.meta.tags,
      seo: blog.seo,
    },
  });
});

/**
 * Get page by slug
 * GET /api/v1/deliver/:projectSlug/pages/:slug
 */
export const getPageBySlug = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectSlug, slug } = req.params;
  const { locale, lang } = req.query;
  const requestedLocale = (lang || locale) as string;
  
  const project = await Project.findOne({
    slug: projectSlug,
    tenantId: req.tenantId,
    status: 'active',
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  const page = await Content.findOne({
    projectId: project._id,
    type: ContentTypes.PAGE,
    slug,
    status: 'published',
    visibility: 'public',
    isDeleted: false,
  });
  
  if (!page) {
    throw new AppError('Page not found', 404);
  }

  // Phase 6: Track Content Insight
  analyticsService.trackEvent({
    tenantId: project.tenantId.toString(),
    type: 'content_operation',
    category: 'delivery',
    action: 'view',
    projectId: project._id.toString(),
    metadata: {
      contentId: page._id.toString(),
      contentType: ContentTypes.PAGE,
      slug: page.slug
    }
  }).catch(err => console.error('Analytics Error:', err));
  
  // Get localized data

  const contentData = requestedLocale && page.localizedData?.[requestedLocale]
    ? { ...page.data, ...page.localizedData[requestedLocale] }
    : page.data;
  
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  
  res.json({
    success: true,
    data: {
      slug: page.slug,
      title: contentData.title || page.name,
      content: contentData,
      seo: page.seo,
    },
  });
});

/**
 * Get FAQs
 * GET /api/v1/deliver/:projectSlug/faqs
 */
export const getFAQs = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectSlug } = req.params;
  const { locale, lang } = req.query;
  const requestedLocale = (lang || locale) as string;
  
  const project = await Project.findOne({
    slug: projectSlug,
    tenantId: req.tenantId,
    status: 'active',
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  // Get default FAQ section or all FAQ items
  const faq = await Content.findOne({
    projectId: project._id,
    type: ContentTypes.FAQ,
    isDefault: true,
    status: 'published',
    isDeleted: false,
  });
  
  if (!faq) {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      success: true,
      data: null,
    });
    return;
  }
  
  const contentData = requestedLocale && faq.localizedData?.[requestedLocale]
    ? { ...faq.data, ...faq.localizedData[requestedLocale] }
    : faq.data;
  
  res.set('Cache-Control', 'public, max-age=300');
  
  res.json({
    success: true,
    data: {
      title: contentData.title,
      subtitle: contentData.subtitle,
      categories: contentData.categories,
    },
  });
});

/**
 * Get testimonials
 * GET /api/v1/deliver/:projectSlug/testimonials
 */
export const getTestimonials = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectSlug } = req.params;
  const { locale, lang } = req.query;
  const requestedLocale = (lang || locale) as string;
  
  const project = await Project.findOne({
    slug: projectSlug,
    tenantId: req.tenantId,
    status: 'active',
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  const section = await Content.findOne({
    projectId: project._id,
    type: ContentTypes.TESTIMONIAL,
    isDefault: true,
    status: 'published',
    isDeleted: false,
  });
  
  if (!section) {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      success: true,
      data: null,
    });
    return;
  }
  
  const contentData = requestedLocale && section.localizedData?.[requestedLocale]
    ? { ...section.data, ...section.localizedData[requestedLocale] }
    : section.data;
  
  res.set('Cache-Control', 'public, max-age=300');
  
  res.json({
    success: true,
    data: contentData,
  });
});

/**
 * Chat with AI bot
 * POST /api/v1/deliver/:projectSlug/chat
 */
export const chatWithBot = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectSlug } = req.params;
  const { message, sessionId } = req.body;
  
  if (!message) {
    throw new AppError('Message is required', 400);
  }
  
  const project = await Project.findOne({
    slug: projectSlug,
    tenantId: req.tenantId,
    status: 'active',
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  if (!project.chatbot?.enabled) {
    throw new AppError('Chatbot is not enabled for this project', 400);
  }
  
  // Try to find matching Q&A from knowledge base
  const matches = await Knowledge.find(
    {
      projectId: project._id,
      status: 'active',
      $text: { $search: message },
    },
    { score: { $meta: 'textScore' } }
  )
    .sort({ score: { $meta: 'textScore' }, priority: -1 })
    .limit(3);
  
  let response: string;
  let matchedKnowledge = null;
  
  if (matches.length > 0 && matches[0]) {
    // Use best match
    matchedKnowledge = matches[0];
    response = matchedKnowledge.answer;
    
    // Record usage
    await (matchedKnowledge as any).recordUsage();
  } else {
    // No match found, use fallback
    response = project.chatbot.fallbackMessage || "I'm sorry, I don't have information about that. Would you like to speak with a human?";
  }
  
  // TODO: If AI is enabled, use OpenAI to generate response based on knowledge base
  
  res.json({
    success: true,
    data: {
      message: response,
      sessionId: sessionId || `session_${Date.now()}`,
      matchedQuestion: matchedKnowledge?.question,
      followUp: matchedKnowledge?.followUp,
      suggestions: project.chatbot.quickActions,
    },
  });
});

/**
 * Get chatbot configuration (for embed widget)
 * GET /api/v1/deliver/:projectSlug/chatbot/config
 */
export const getChatbotConfig = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectSlug } = req.params;
  
  const project = await Project.findOne({
    slug: projectSlug,
    tenantId: req.tenantId,
    status: 'active',
  }).select('chatbot branding');
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  if (!project.chatbot?.enabled) {
    res.json({
      success: true,
      data: { enabled: false },
    });
    return;
  }
  
  res.set('Cache-Control', 'public, max-age=300');
  
  res.json({
    success: true,
    data: {
      enabled: true,
      name: project.chatbot.name,
      avatar: project.chatbot.avatar,
      greeting: project.chatbot.greeting,
      quickActions: project.chatbot.quickActions,
      position: project.chatbot.position,
      theme: project.chatbot.theme,
      branding: {
        logo: project.branding?.logo,
        colors: project.branding?.colors,
      },
    },
  });
});

// ============================
// Custom content types (collections)
// ============================

const SORTABLE = new Set(['publishedAt', 'createdAt', 'updatedAt', 'name', 'order']);

async function resolveCollection(req: Request) {
  const { projectSlug, apiId } = req.params;
  const project = await Project.findOne({ slug: projectSlug, tenantId: req.tenantId, status: 'active' });
  if (!project) throw new AppError('Project not found', 404);
  // Built-in types (blog, faq, popup…) are addressable here too
  if ((Object.values(ContentTypes) as string[]).includes(apiId) && apiId !== ContentTypes.CUSTOM) {
    return { project, filter: { type: apiId } as Record<string, unknown> };
  }
  const contentType = await ContentTypeModel.findOne({ tenantId: req.tenantId, apiId }).select('_id').lean();
  if (!contentType) throw new AppError('Content type not found', 404);
  return { project, filter: { type: ContentTypes.CUSTOM, contentTypeId: contentType._id } as Record<string, unknown> };
}

const localized = (item: any, locale?: string) =>
  locale && item.localizedData?.[locale] ? { ...item.data, ...item.localizedData[locale] } : item.data;

const shapeEntry = (item: any, locale?: string) => ({
  id: String(item._id),
  slug: item.slug,
  name: item.name,
  data: localized(item, locale),
  seo: item.seo,
  publishedAt: item.meta?.publishedAt,
  updatedAt: item.updatedAt,
});

/**
 * List published entries of any content type, including custom ones
 * GET /api/v1/deliver/:projectSlug/collections/:apiId?page=&limit=&sort=-publishedAt&locale=&data.<field>=<value>
 */
export const getCollection = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { project, filter } = await resolveCollection(req);
  const locale = (req.query.lang || req.query.locale) as string | undefined;
  const query: Record<string, unknown> = {
    ...filter, projectId: project._id, status: 'published', visibility: 'public', isDeleted: false,
  };
  // Simple equality filters on data fields: ?data.category=shoes
  for (const [k, v] of Object.entries(req.query)) {
    if (/^data\.[A-Za-z0-9_]{1,64}$/.test(k) && typeof v === 'string') query[k] = v.slice(0, 200);
  }
  const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
  const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit)) || 20));
  const rawSort = String(req.query.sort || '-publishedAt');
  const field = rawSort.replace(/^-/, '');
  const sortField = SORTABLE.has(field) ? (field === 'publishedAt' ? 'meta.publishedAt' : field === 'order' ? 'data.order' : field) : 'meta.publishedAt';
  const sort: Record<string, 1 | -1> = { [sortField]: rawSort.startsWith('-') ? -1 : 1, _id: -1 };

  const [items, total] = await Promise.all([
    Content.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Content.countDocuments(query),
  ]);
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
  res.json({
    success: true,
    data: {
      items: items.map((i) => shapeEntry(i, locale)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  });
});

/**
 * Single published entry of any content type by slug
 * GET /api/v1/deliver/:projectSlug/collections/:apiId/:slug
 */
export const getCollectionItem = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { project, filter } = await resolveCollection(req);
  const locale = (req.query.lang || req.query.locale) as string | undefined;
  const item = await Content.findOne({
    ...filter, projectId: project._id, slug: req.params.slug, status: 'published', visibility: 'public', isDeleted: false,
  }).lean();
  if (!item) throw new AppError('Entry not found', 404);
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
  res.json({ success: true, data: shapeEntry(item, locale) });
});
