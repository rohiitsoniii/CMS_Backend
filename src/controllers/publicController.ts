import { Request, Response } from 'express';
import { Content, type ContentType } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { cacheGet, cacheSet } from '../config/redis.js';

const CACHE_TTL = 300; // 5 minutes

/**
 * Get published content by type
 * GET /api/v1/content/:type
 */
export const getContentByType = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { type } = req.params;
  const tenantId = req.tenantId!;
  
  // Check cache
  const cacheKey = `content:${tenantId}:${type}`;
  const cached = await cacheGet(cacheKey);
  
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }
  
  // Query published content
  const contents = await Content.find({
    tenantId,
    type: type as ContentType,
    status: 'published',
    isDeleted: false,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } },
    ],
  })
    .select('name slug data metadata publishedAt order tags category')
    .sort({ order: 1, publishedAt: -1 });
  
  const response = {
    success: true,
    data: contents.map(c => ({
      id: c._id,
      name: c.name,
      slug: c.slug,
      ...c.data,
      metadata: c.metadata,
      publishedAt: c.publishedAt,
      order: c.order,
      tags: c.tags,
      category: c.category,
    })),
  };
  
  // Cache response
  await cacheSet(cacheKey, JSON.stringify(response), CACHE_TTL);
  
  res.json(response);
});

/**
 * Get single content by type and slug
 * GET /api/v1/content/:type/:slug
 */
export const getContentBySlug = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { type, slug } = req.params;
  const tenantId = req.tenantId!;
  
  // Check cache
  const cacheKey = `content:${tenantId}:${type}:${slug}`;
  const cached = await cacheGet(cacheKey);
  
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }
  
  // Query published content
  const content = await Content.findOne({
    tenantId,
    type: type as ContentType,
    slug,
    status: 'published',
    isDeleted: false,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } },
    ],
  }).select('name slug data metadata publishedAt order tags category author')
    .populate('author', 'firstName lastName');
  
  if (!content) {
    throw new AppError('Content not found', 404);
  }
  
  const response = {
    success: true,
    data: {
      id: content._id,
      name: content.name,
      slug: content.slug,
      ...content.data,
      metadata: content.metadata,
      publishedAt: content.publishedAt,
      tags: content.tags,
      category: content.category,
      author: content.author,
    },
  };
  
  // Cache response
  await cacheSet(cacheKey, JSON.stringify(response), CACHE_TTL);
  
  res.json(response);
});

/**
 * Get all hero sections
 * GET /api/v1/content/hero-sections
 */
export const getHeroSections = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  req.params.type = 'hero_section';
  return getContentByType(req, res);
});

/**
 * Get navigation menus
 * GET /api/v1/content/navigation
 */
export const getNavigation = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  req.params.type = 'navigation';
  return getContentByType(req, res);
});

/**
 * Get footer content
 * GET /api/v1/content/footer
 */
export const getFooter = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  req.params.type = 'footer';
  return getContentByType(req, res);
});

/**
 * Get all blog posts
 * GET /api/v1/content/blogs
 */
export const getBlogs = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenantId!;
  const { page = 1, limit = 10, tag, category } = req.query;
  
  // Build query
  const query: Record<string, unknown> = {
    tenantId,
    type: 'blog_post',
    status: 'published',
    isDeleted: false,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } },
    ],
  };
  
  if (tag) query.tags = tag;
  if (category) query.category = category;
  
  // Check cache for default query
  const cacheKey = `content:${tenantId}:blogs:${page}:${limit}:${tag || ''}:${category || ''}`;
  const cached = await cacheGet(cacheKey);
  
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }
  
  // Pagination
  const skip = (Number(page) - 1) * Number(limit);
  
  // Execute query
  const [blogs, total] = await Promise.all([
    Content.find(query)
      .select('name slug data.title data.excerpt data.featured_image data.author metadata publishedAt tags category')
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('author', 'firstName lastName'),
    Content.countDocuments(query),
  ]);
  
  const response = {
    success: true,
    data: {
      blogs: blogs.map(b => ({
        id: b._id,
        name: b.name,
        slug: b.slug,
        title: (b.data as Record<string, unknown>).title,
        excerpt: (b.data as Record<string, unknown>).excerpt,
        featuredImage: (b.data as Record<string, unknown>).featured_image,
        author: b.author || (b.data as Record<string, unknown>).author,
        metadata: b.metadata,
        publishedAt: b.publishedAt,
        tags: b.tags,
        category: b.category,
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    },
  };
  
  // Cache response
  await cacheSet(cacheKey, JSON.stringify(response), CACHE_TTL);
  
  res.json(response);
});

/**
 * Get single blog post by slug
 * GET /api/v1/content/blogs/:slug
 */
export const getBlogBySlug = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  req.params.type = 'blog_post';
  return getContentBySlug(req, res);
});

/**
 * Get FAQs
 * GET /api/v1/content/faqs
 */
export const getFAQs = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  req.params.type = 'faq';
  return getContentByType(req, res);
});

/**
 * Get testimonials
 * GET /api/v1/content/testimonials
 */
export const getTestimonials = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  req.params.type = 'testimonials';
  return getContentByType(req, res);
});

/**
 * Get gallery
 * GET /api/v1/content/gallery
 */
export const getGallery = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  req.params.type = 'gallery';
  return getContentByType(req, res);
});

/**
 * Search content
 * GET /api/v1/content/search
 */
export const searchContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenantId!;
  const { q, type, page = 1, limit = 10 } = req.query;
  
  if (!q) {
    throw new AppError('Search query is required', 400);
  }
  
  // Build query
  const query: Record<string, unknown> = {
    tenantId,
    status: 'published',
    isDeleted: false,
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { 'data.title': { $regex: q, $options: 'i' } },
      { 'data.content': { $regex: q, $options: 'i' } },
      { tags: { $in: [new RegExp(q as string, 'i')] } },
    ],
  };
  
  if (type) query.type = type;
  
  // Pagination
  const skip = (Number(page) - 1) * Number(limit);
  
  const [results, total] = await Promise.all([
    Content.find(query)
      .select('type name slug data.title data.excerpt metadata publishedAt')
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Content.countDocuments(query),
  ]);
  
  res.json({
    success: true,
    data: {
      results: results.map(r => ({
        id: r._id,
        type: r.type,
        name: r.name,
        slug: r.slug,
        title: (r.data as Record<string, unknown>).title || r.name,
        excerpt: (r.data as Record<string, unknown>).excerpt,
        metadata: r.metadata,
        publishedAt: r.publishedAt,
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});
