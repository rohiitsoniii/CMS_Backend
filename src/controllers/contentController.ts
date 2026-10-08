import { Request, Response } from 'express';
import { contentEvents } from '../services/contentEvents.js';
import mongoose from 'mongoose';
import { Content, Project, ContentTypes, ContentType as ContentTypeModel } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import type { ContentType, ContentStatus } from '../models/Content.js';
import { AuditService } from '../services/AuditService.js';
import { NotificationService } from '../services/notificationService.js';
import { CacheService } from '../services/cacheService.js';
import { embeddingService } from '../services/embeddingService.js';
import { contentPublishedTotal } from '../utils/metrics.js';
import { escapeSearchTerm } from '../utils/queryBuilder.js';
import { runInTransaction } from '../utils/transactions.js';

/**
 * Create content
 * POST /api/v1/projects/:projectId/content
 */
export const createContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const projectId = req.params.projectId || req.body.projectId;
  const { type, name, slug, data, status, isDefault, visibility, meta, seo, locale, contentTypeId } = req.body;
  
  if (!projectId) {
    throw new AppError('Project ID is required', 400);
  }

  // Verify project exists and belongs to tenant
  const project = await Project.findOne({
    _id: projectId,
    tenantId: req.tenantId,
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  // Validate or default content type. A custom type can be named by its
  // apiId (e.g. "product"), which is what API-only clients naturally send.
  let resolvedType = type || (contentTypeId ? ContentTypes.CUSTOM : undefined);
  let resolvedContentTypeId = contentTypeId;
  if (resolvedType && !Object.values(ContentTypes).includes(resolvedType)) {
    const custom = typeof resolvedType === 'string'
      ? await ContentTypeModel.findOne({ tenantId: req.tenantId, apiId: resolvedType }).select('_id').lean()
      : null;
    if (custom) {
      resolvedType = ContentTypes.CUSTOM;
      resolvedContentTypeId = custom._id;
    }
  }
  if (!resolvedType || !Object.values(ContentTypes).includes(resolvedType)) {
    throw new AppError(`Invalid content type: ${type}`, 400);
  }

  const resolvedName = name || data?.title || data?.name || 'Untitled Content';
  const resolvedSlug = slug 
    ? slug.toLowerCase() 
    : (resolvedName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'content') + '-' + Date.now().toString(36);
  
  // Check for duplicate slug in same project
  const existingContent = await Content.findOne({
    projectId,
    slug: resolvedSlug,
    isDeleted: false,
  });
  
  if (existingContent) {
    throw new AppError('A content item with this slug already exists', 400, 'DUPLICATE_SLUG');
  }
  
  // If isDefault and there's already a default, unset it — together with
  // the create + stats update inside one transaction (no half-created state)
  const content = await runInTransaction(async (session) => {
    const opts = session ? { session } : {};
    if (isDefault) {
      await Content.updateMany(
        { projectId, type: resolvedType, isDeleted: false },
        { isDefault: false },
        opts
      );
    }
    const created = await Content.create(
      [
        {
          projectId,
          tenantId: req.tenantId,
          type: resolvedType,
          contentTypeId: resolvedContentTypeId || undefined,
          name: resolvedName,
          slug: resolvedSlug,
          data: data || {},
          status: status || 'draft',
          isDefault: isDefault || false,
          visibility: visibility || 'public',
          meta: meta || {},
          seo: seo || {},
          locale: locale || project.settings?.defaultLocale || 'en',
          createdBy: req.userId,
        },
      ],
      opts
    ).then((docs) => docs[0]);
    await Project.updateOne({ _id: projectId }, { $inc: { 'stats.contentCount': 1 } }, opts);
    return created;
  });
  
  await AuditService.log(req, 'content.create', {
    type: 'Content',
    id: String(content._id),
    name: content.name
  }, { projectId, contentType: type });
  
  try {
    await CacheService.invalidateProject(req.tenantId!.toString(), projectId.toString());
  } catch {
    // Redis is optional in development
  }
  
  // Async fire-and-forget embedding generation
  embeddingService.embedContent(String(content._id)).catch(err => console.error("Embedding generation failed", err));

  const contentObj = content.toObject ? content.toObject() : content;

  res.status(201).json({
    success: true,
    message: 'Content created successfully',
    data: {
      ...contentObj,
      content,
    },
  });
});

/**
 * List content by type
 * GET /api/v1/projects/:projectId/content
 */
export const getContentList = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const projectId = req.params.projectId || req.query.projectId;
  const { type, contentTypeId, status, search, page = 1, limit = 20, includeArchived } = req.query;

  const query: Record<string, unknown> = {
    tenantId: req.tenantId,
    isDeleted: false,
  };

  // Coerce to strings — Express parses ?type[$gt]= as an object (qs),
  // which would otherwise land verbatim in the Mongo query (NoSQL injection).
  if (projectId) query.projectId = String(projectId);
  if (type) query.type = String(type);
  if (contentTypeId) query.contentTypeId = String(contentTypeId);
  // ?type=<custom apiId> lists entries of that custom content type
  if (type && !(Object.values(ContentTypes) as string[]).includes(String(type))) {
    const custom = await ContentTypeModel.findOne({ tenantId: req.tenantId, apiId: String(type) }).select('_id').lean();
    if (custom) {
      query.type = ContentTypes.CUSTOM;
      query.contentTypeId = custom._id;
    }
  }
  if (status && status !== 'all') query.status = String(status);
  if (!includeArchived && (!status || status === 'all')) query.status = { $ne: 'archived' };

  if (search && typeof search === 'string') {
    const term = escapeSearchTerm(search);
    query.$or = [
      { name: { $regex: term, $options: 'i' } },
      { 'data.title': { $regex: term, $options: 'i' } },
    ];
  }

  const safePage = Math.max(1, Math.floor(Number(page)) || 1);
  const safeLimit = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 20));
  const skip = (safePage - 1) * safeLimit;

  const [contents, total] = await Promise.all([
    Content.find(query)
      .sort({ isDefault: -1, 'meta.order': 1, updatedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('createdBy', 'firstName lastName')
      .populate('meta.author', 'firstName lastName'),
    Content.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: contents,
    contents,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
    total,
    page: safePage,
    pages: Math.ceil(total / safeLimit),
  });
});

/**
 * Get content by type (shorthand routes)
 * GET /api/v1/projects/:projectId/headers
 * GET /api/v1/projects/:projectId/footers
 * etc.
 */
export const getContentByType = (contentType: ContentType) => {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    const { status } = req.query;
    
    const project = await Project.findOne({
      _id: projectId,
      tenantId: req.tenantId,
    });
    
    if (!project) {
      throw new AppError('Project not found', 404);
    }
    
    const query: Record<string, unknown> = {
      projectId,
      tenantId: req.tenantId,
      type: contentType,
      isDeleted: false,
    };

    
    if (status) query.status = String(status);
    
    const contents = await Content.find(query)
      .sort({ isDefault: -1, 'meta.order': 1, updatedAt: -1 })
      .populate('createdBy', 'firstName lastName');
    
    res.json({
      success: true,
      data: { contents },
    });
  });
};

/**
 * Get single content
 * GET /api/v1/projects/:projectId/content/:id
 * GET /api/v1/content/:id
 */
export const getContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const projectId = req.params.projectId || req.query.projectId;
  
  const query: any = {
    _id: id,
    tenantId: req.tenantId,
    isDeleted: false,
  };
  if (projectId) query.projectId = projectId;

  const content = await Content.findOne(query)
    .populate('createdBy', 'firstName lastName')
    .populate('updatedBy', 'firstName lastName')
    .populate('meta.author', 'firstName lastName');
  
  if (!content) {
    throw new AppError('Content not found', 404);
  }
  
  res.json({
    success: true,
    data: content,
    content,
  });
});

/**
 * Update content
 * PUT /api/v1/projects/:projectId/content/:id
 */
export const updateContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const projectId = req.params.projectId || req.body.projectId;
  const { name, slug, data, status, isDefault, visibility, meta, seo, changeNote } = req.body;
  
  const query: any = {
    _id: id,
    tenantId: req.tenantId,
    isDeleted: false,
  };
  if (projectId) query.projectId = projectId;

  const content = await Content.findOne(query);
  
  if (!content) {
    throw new AppError('Content not found', 404);
  }
  
  // Save current version to history
  if (typeof (content as any).saveVersion === 'function') {
    await (content as any).saveVersion(req.userId!, changeNote);
  }
  
  // Update fields
  if (name !== undefined) content.name = name;
  if (slug !== undefined) content.slug = slug?.toLowerCase();
  if (data !== undefined) content.data = data;
  if (status !== undefined) content.status = status as ContentStatus;
  if (visibility !== undefined) content.visibility = visibility;
  if (meta !== undefined) content.meta = { ...content.meta, ...meta };
  if (seo !== undefined) content.seo = { ...content.seo, ...seo };
  
  content.updatedBy = new mongoose.Types.ObjectId(req.userId);
  
  // Handle default setting
  if (isDefault !== undefined && isDefault !== content.isDefault) {
    if (isDefault) {
      await Content.updateMany(
        { projectId: content.projectId, tenantId: req.tenantId, type: content.type, _id: { $ne: id }, isDeleted: false },
        { isDefault: false }
      );
    }
    content.isDefault = isDefault;
  }
  
  await content.save();
  
  await AuditService.log(req, 'content.update', {
    type: 'Content',
    id: String(content._id),
    name: content.name
  }, { projectId: content.projectId?.toString() });
  
  if (content.projectId) {
    await CacheService.invalidateProject(req.tenantId!.toString(), content.projectId.toString());
  }

  // Async fire-and-forget embedding generation
  embeddingService.embedContent(String(content._id)).catch(err => console.error("Embedding generation failed", err));

  res.json({
    success: true,
    message: 'Content updated successfully',
    data: content,
    content,
  });
});

/**
 * Set content as default
 * POST /api/v1/projects/:projectId/content/:id/default
 * POST /api/v1/content/:id/default
 */
export const setContentAsDefault = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const projectId = req.params.projectId || req.body.projectId;
  
  const query: any = {
    _id: id,
    tenantId: req.tenantId,
    isDeleted: false,
  };
  if (projectId) query.projectId = projectId;

  const content = await Content.findOne(query);
  
  if (!content) {
    throw new AppError('Content not found', 404);
  }
  
  // Unset all other defaults of same type + set this one atomically
  await runInTransaction(async (session) => {
    const opts = session ? { session } : {};
    await Content.updateMany(
      { projectId: content.projectId, tenantId: req.tenantId, type: content.type, _id: { $ne: id }, isDeleted: false },
      { isDefault: false },
      opts
    );
    content.isDefault = true;
    await content.save(opts);
  });
  
  if (content.projectId) {
    await CacheService.invalidateProject(req.tenantId!.toString(), content.projectId.toString());
  }

  res.json({
    success: true,
    message: `${content.name} is now the default ${content.type}`,
    data: content,
    content,
  });
});

/**
 * Publish content
 * POST /api/v1/projects/:projectId/content/:id/publish
 * POST /api/v1/content/:id/publish
 */
export const publishContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const projectId = req.params.projectId || req.body.projectId;
  const { scheduledAt } = req.body;
  
  const query: any = {
    _id: id,
    tenantId: req.tenantId,
    isDeleted: false,
  };
  if (projectId) query.projectId = projectId;

  const content = await Content.findOne(query);
  
  if (!content) {
    throw new AppError('Content not found', 404);
  }
  
  if (scheduledAt) {
    content.status = 'scheduled';
    content.meta.scheduledAt = new Date(scheduledAt);
    
    // Send scheduled notification
    await NotificationService.notifyContentScheduled(
      content._id,
      new Date(scheduledAt),
      new mongoose.Types.ObjectId(req.userId)
    );
  } else {
    await content.publish();
    contentPublishedTotal.labels(req.tenantId!.toString(), content.type).inc();

    // Send published notification
    await NotificationService.notifyContentPublished(
      content._id,
      new mongoose.Types.ObjectId(req.userId)
    );
  }
  
  content.updatedBy = new mongoose.Types.ObjectId(req.userId);
  await content.save();
  
  // Update project stats
  if (content.projectId) {
    await Project.updateOne({ _id: content.projectId }, { 'stats.lastPublishedAt': new Date() });
    await CacheService.invalidateProject(req.tenantId!.toString(), content.projectId.toString());
  }
  
  if (!scheduledAt) contentEvents.published(content);

  await AuditService.log(req, scheduledAt ? 'content.schedule' : 'content.publish', {
    type: 'Content',
    id: String(content._id),
    name: content.name
  }, { projectId: content.projectId?.toString(), scheduledAt });

  res.json({
    success: true,
    message: scheduledAt ? 'Content scheduled for publishing' : 'Content published successfully',
    data: content,
    content,
  });
});

/**
 * Unpublish content
 * POST /api/v1/projects/:projectId/content/:id/unpublish
 * POST /api/v1/content/:id/unpublish
 */
export const unpublishContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const projectId = req.params.projectId || req.body.projectId;
  
  const query: any = {
    _id: id,
    tenantId: req.tenantId,
    isDeleted: false,
  };
  if (projectId) query.projectId = projectId;

  const content = await Content.findOne(query);
  
  if (!content) {
    throw new AppError('Content not found', 404);
  }
  
  await content.unpublish();
  content.updatedBy = new mongoose.Types.ObjectId(req.userId);
  await content.save();
  
  if (content.projectId) {
    await CacheService.invalidateProject(req.tenantId!.toString(), content.projectId.toString());
  }

  contentEvents.unpublished(content);

  await AuditService.log(req, 'content.unpublish', {
    type: 'Content',
    id: String(content._id),
    name: content.name
  }, { projectId: content.projectId?.toString() });

  res.json({
    success: true,
    message: 'Content unpublished',
    data: content,
    content,
  });
});

/**
 * Delete content (soft delete)
 * DELETE /api/v1/projects/:projectId/content/:id
 * DELETE /api/v1/content/:id
 */
export const deleteContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const projectId = req.params.projectId || req.body.projectId;
  
  const query: any = { _id: id, tenantId: req.tenantId, isDeleted: false };
  if (projectId) query.projectId = projectId;

  const content = await Content.findOneAndUpdate(
    query,
    {
      isDeleted: true,
      deletedAt: new Date(),
      deletedBy: req.userId,
      isDefault: false,
    },
    { new: true }
  );
  
  if (!content) {
    throw new AppError('Content not found', 404);
  }

  if (content.projectId) {
    await Project.updateOne({ _id: content.projectId }, { $inc: { 'stats.contentCount': -1 } });
    await CacheService.invalidateProject(req.tenantId!.toString(), content.projectId.toString());
  }
  
  contentEvents.deleted(content);

  await AuditService.log(req, 'content.archive', {
    type: 'Content',
    id: String(content._id),
    name: content.name
  }, { projectId: content.projectId?.toString() });

  res.json({
    success: true,
    message: 'Content moved to trash',
  });
});

/**
 * Get version history
 * GET /api/v1/projects/:projectId/content/:id/versions
 */
export const getVersionHistory = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const projectId = req.params.projectId || req.query.projectId;
  const tenantId = req.tenantId || req.user?.tenantId;

  const query: any = { _id: id };
  if (tenantId) query.tenantId = tenantId;
  if (projectId) query.projectId = projectId;

  let content = await Content.findOne(query).select('+versionHistory').populate('versionHistory.changedBy', 'firstName lastName');
  if (!content) {
    content = await Content.findById(id).select('+versionHistory').populate('versionHistory.changedBy', 'firstName lastName');
  }
  
  if (!content) {
    throw new AppError('Content not found', 404);
  }

  const versions = Array.isArray(content.versionHistory) ? [...content.versionHistory].reverse() : [];
  
  res.json({
    success: true,
    data: {
      contentId: content._id,
      currentVersion: content.version,
      publishedVersion: content.publishedVersion,
      versions,
      history: versions,
      total: versions.length,
    },
  });
});

/**
 * Restore to previous version
 * POST /api/v1/projects/:projectId/content/:id/versions/:version/restore
 */
export const restoreVersion = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id, version } = req.params;
  const projectId = req.params.projectId || req.query.projectId || req.body?.projectId;
  const tenantId = req.tenantId || req.user?.tenantId;

  const query: any = { _id: id };
  if (tenantId) query.tenantId = tenantId;
  if (projectId) query.projectId = projectId;

  let content = await Content.findOne(query).select('+versionHistory');
  if (!content) {
    content = await Content.findById(id).select('+versionHistory');
  }
  
  if (!content) {
    throw new AppError('Content not found', 404);
  }
  
  const targetVersion = content.versionHistory?.find((v: any) => v.version === Number(version));
  
  if (!targetVersion) {
    throw new AppError('Version not found', 404);
  }
  
  // Save current version first
  if (typeof content.saveVersion === 'function') {
    await content.saveVersion((req.userId || req.user?._id) as string, `Before restoring to version ${version}`);
  }
  
  // Restore data
  content.data = targetVersion.data;
  content.localizedData = targetVersion.localizedData;
  content.status = 'draft';
  if (req.userId || req.user?._id) {
    content.updatedBy = new mongoose.Types.ObjectId(req.userId || req.user?._id);
  }
  
  await content.save();
  
  try {
    await AuditService.log(req, 'content.restore', {
      type: 'Content',
      id: String(content._id),
      name: content.name
    }, { projectId: projectId || content.projectId, version });
  } catch (e) {}
  
  try {
    const tid = tenantId || content.tenantId;
    const pid = projectId || content.projectId;
    if (tid && pid) {
      await CacheService.invalidateProject(tid.toString(), pid.toString());
    }
  } catch (e) {}

  res.json({
    success: true,
    message: `Restored to version ${version}`,
    data: { content },
  });
});

/**
 * Reorder content items
 * PUT /api/v1/projects/:projectId/content/reorder
 */
export const reorderContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  const { type, order } = req.body; // order: [{ id: 'xxx', position: 0 }, ...]
  
  if (!Array.isArray(order)) {
    throw new AppError('Order must be an array', 400);
  }
  
  const bulkOps = order.map((item: { id: string; position: number }) => ({
    updateOne: {
      filter: { 
        _id: new mongoose.Types.ObjectId(item.id), 
        projectId: new mongoose.Types.ObjectId(projectId), 
        type 
      },
      update: { 'meta.order': item.position },
    },
  }));

  
  await Content.bulkWrite(bulkOps);
  
  res.json({
    success: true,
    message: 'Content reordered successfully',
  });
});

/**
 * Duplicate content
 * POST /api/v1/projects/:projectId/content/:id/duplicate
 */
export const duplicateContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId, id } = req.params;
  const { name, includeRelationships } = req.body;
  
  const original = await Content.findOne({
    _id: id,
    projectId,
    isDeleted: false,
  });
  
  if (!original) {
    throw new AppError('Content not found', 404);
  }
  
  // Generate unique slug
  const timestamp = Date.now();
  const baseSlug = original.slug || original.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const newSlug = `${baseSlug}-copy-${timestamp}`;
  
  // Create duplicate
  const duplicate = await Content.create({
    projectId: original.projectId,
    tenantId: original.tenantId,
    type: original.type,
    name: name || `${original.name} (Copy)`,
    slug: newSlug,
    data: JSON.parse(JSON.stringify(original.data)),
    status: 'draft',
    isDefault: false,
    visibility: original.visibility,
    meta: {
      ...JSON.parse(JSON.stringify(original.meta)),
      publishedAt: undefined,
      scheduledAt: undefined,
    },
    seo: JSON.parse(JSON.stringify(original.seo || {})),
    locale: original.locale,
    localizedData: original.localizedData ? JSON.parse(JSON.stringify(original.localizedData)) : undefined,
    relationships: includeRelationships ? JSON.parse(JSON.stringify(original.relationships || {})) : undefined,
    createdBy: req.userId,
  });
  
  await AuditService.log(req, 'content.duplicate', {
    type: 'Content',
    id: String(duplicate._id),
    name: duplicate.name
  }, { projectId, originalId: String(original._id) });
  
  res.status(201).json({
    success: true,
    message: 'Content duplicated successfully',
    data: { content: duplicate },
  });
});

/**
 * Get trash (deleted content)
 * GET /api/v1/projects/:projectId/content/trash
 */
export const getTrash = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  const { type, page = 1, limit = 20 } = req.query;
  
  const project = await Project.findOne({
    _id: projectId,
    tenantId: req.tenantId,
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  const query: Record<string, unknown> = {
    projectId,
    tenantId: req.tenantId,
    isDeleted: true,
  };

  
  if (type) query.type = type;
  
  const skip = (Number(page) - 1) * Number(limit);
  
  const [contents, total] = await Promise.all([
    Content.find(query)
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('createdBy', 'firstName lastName')
      .populate('deletedBy', 'firstName lastName'),
    Content.countDocuments(query),
  ]);
  
  res.json({
    success: true,
    data: {
      contents,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/**
 * Restore content from trash
 * POST /api/v1/projects/:projectId/content/:id/restore
 */
export const restoreContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId, id } = req.params;
  
  const content = await Content.findOne({
    _id: id,
    projectId,
    tenantId: req.tenantId,
    isDeleted: true,
  });

  
  if (!content) {
    throw new AppError('Content not found in trash', 404);
  }
  
  content.isDeleted = false;
  content.deletedAt = undefined;
  content.deletedBy = undefined;
  content.status = 'draft';
  await content.save();
  
  // Update project stats
  await Project.updateOne({ _id: projectId }, { $inc: { 'stats.contentCount': 1 } });
  
  await AuditService.log(req, 'content.restore', {
    type: 'Content',
    id: String(content._id),
    name: content.name
  }, { projectId });
  
  res.json({
    success: true,
    message: 'Content restored successfully',
    data: { content },
  });
});

/**
 * Permanently delete content
 * DELETE /api/v1/projects/:projectId/content/:id/permanent
 */
export const permanentDeleteContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId, id } = req.params;
  
  const content = await Content.findOne({
    _id: id,
    projectId,
    tenantId: req.tenantId,
    isDeleted: true,
  });

  
  if (!content) {
    throw new AppError('Content not found in trash', 404);
  }
  
  const contentName = content.name;
  await Content.deleteOne({ _id: id });
  
  await AuditService.log(req, 'content.delete_permanent', {
    type: 'Content',
    id: String(id),
    name: contentName
  }, { projectId });
  
  res.json({
    success: true,
    message: 'Content permanently deleted',
  });
});

/**
 * Empty trash (delete all)
 * DELETE /api/v1/projects/:projectId/content/trash/empty
 */
export const emptyTrash = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  const { olderThan } = req.query; // Optional: delete items older than X days
  
  const query: Record<string, unknown> = {
    projectId,
    tenantId: req.tenantId,
    isDeleted: true,
  };

  
  if (olderThan) {
    const date = new Date();
    date.setDate(date.getDate() - Number(olderThan));
    query.deletedAt = { $lt: date };
  }
  
  const result = await Content.deleteMany(query);
  
  await AuditService.log(req, 'content.empty_trash', {
    type: 'Content',
    id: projectId,
    name: 'Trash'
  }, { projectId, deletedCount: result.deletedCount });
  
  res.json({
    success: true,
    message: `Permanently deleted ${result.deletedCount} items`,
    data: { deletedCount: result.deletedCount },
  });
});

/**
 * Bulk operations
 * POST /api/v1/projects/:projectId/content/bulk
 */
export const bulkOperations = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  const { action, ids, data } = req.body;
  
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('IDs array is required', 400);
  }
  
  const validActions = ['publish', 'unpublish', 'delete', 'archive', 'addTags', 'removeTags', 'changeStatus'];
  if (!validActions.includes(action)) {
    throw new AppError(`Invalid action. Must be one of: ${validActions.join(', ')}`, 400);
  }
  
  let result;
  let message = '';
  
  switch (action) {
    case 'publish':
      result = await Content.updateMany(
        { _id: { $in: ids }, projectId, tenantId: req.tenantId, isDeleted: false },
        { 
          status: 'published', 
          'meta.publishedAt': new Date(),
          updatedBy: req.userId,
        }
      );

      message = `Published ${result.modifiedCount} items`;
      break;
      
    case 'unpublish':
      result = await Content.updateMany(
        { _id: { $in: ids }, projectId, tenantId: req.tenantId, isDeleted: false },
        { 
          status: 'draft',
          'meta.publishedAt': null,
          updatedBy: req.userId,
        }
      );

      message = `Unpublished ${result.modifiedCount} items`;
      break;
      
    case 'delete':
      result = await Content.updateMany(
        { _id: { $in: ids }, projectId, tenantId: req.tenantId, isDeleted: false },
        { 
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: req.userId,
          isDefault: false,
        }
      );

      await Project.updateOne(
        { _id: projectId },
        { $inc: { 'stats.contentCount': -result.modifiedCount } }
      );
      message = `Deleted ${result.modifiedCount} items`;
      break;
      
    case 'archive':
      result = await Content.updateMany(
        { _id: { $in: ids }, projectId, tenantId: req.tenantId, isDeleted: false },
        { 
          status: 'archived',
          updatedBy: req.userId,
        }
      );

      message = `Archived ${result.modifiedCount} items`;
      break;
      
    case 'addTags':
      if (!data?.tags || !Array.isArray(data.tags)) {
        throw new AppError('Tags array is required', 400);
      }
      result = await Content.updateMany(
        { _id: { $in: ids }, projectId, tenantId: req.tenantId, isDeleted: false },
        { 
          $addToSet: { 'meta.tags': { $each: data.tags } },
          updatedBy: req.userId,
        }
      );

      message = `Added tags to ${result.modifiedCount} items`;
      break;
      
    case 'removeTags':
      if (!data?.tags || !Array.isArray(data.tags)) {
        throw new AppError('Tags array is required', 400);
      }
      result = await Content.updateMany(
        { _id: { $in: ids }, projectId, tenantId: req.tenantId, isDeleted: false },
        { 
          $pull: { 'meta.tags': { $in: data.tags } },
          updatedBy: req.userId,
        }
      );

      message = `Removed tags from ${result.modifiedCount} items`;
      break;
      
    case 'changeStatus':
      if (!data?.status) {
        throw new AppError('Status is required', 400);
      }
      result = await Content.updateMany(
        { _id: { $in: ids }, projectId, tenantId: req.tenantId, isDeleted: false },
        { 
          status: data.status,
          updatedBy: req.userId,
        }
      );

      message = `Changed status to ${data.status} for ${result.modifiedCount} items`;
      break;
  }
  
  await AuditService.log(req, `content.bulk_${action}`, {
    type: 'Content',
    id: projectId,
    name: 'Bulk Operation'
  }, { projectId, action, count: result?.modifiedCount || 0 });
  
  res.json({
    success: true,
    message,
    data: { 
      modifiedCount: result?.modifiedCount || 0,
      matchedCount: result?.matchedCount || 0,
    },
  });
});

/**
 * Get recent content across all projects
 * GET /api/v1/projects/all/content/recent
 */
export const getRecentContent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const contents = await Content.find({
    tenantId: req.tenantId,
    isDeleted: false,
  })
    .sort({ updatedAt: -1 })
    .limit(5)
    .populate('createdBy', 'firstName lastName')
    .populate('projectId', 'name');

  res.json({
    success: true,
    data: { contents },
  });
});

