import { Request, Response } from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { Project, Content, Knowledge } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { config } from '../config/index.js';
import { AuditService } from '../services/AuditService.js';

/**
 * Create a new project
 * POST /api/v1/projects
 */
export const createProject = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { name, slug, description, domain, settings, branding } = req.body;
  
  // Check if slug already exists for this tenant
  const existingProject = await Project.findOne({
    tenantId: req.tenantId,
    slug: slug.toLowerCase(),
  });
  
  if (existingProject) {
    throw new AppError('A project with this slug already exists', 400, 'DUPLICATE_SLUG');
  }
  
  const project = await Project.create({
    tenantId: req.tenantId,
    name,
    slug: slug.toLowerCase(),
    description,
    domain,
    settings: settings || {},
    branding: branding || {},
    status: 'active',
    createdBy: req.userId,
  });
  
  await AuditService.log(req, 'project.create', {
    type: 'Project',
    id: String(project._id),
    name: project.name
  });
  
  res.status(201).json({
    success: true,
    message: 'Project created successfully',
    data: { project },
  });
});

/**
 * List all projects for tenant
 * GET /api/v1/projects
 */
export const getProjects = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { status, search, page = 1, limit = 20 } = req.query;
  
  const query: Record<string, unknown> = { tenantId: req.tenantId };
  
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }
  
  const skip = (Number(page) - 1) * Number(limit);
  
  const [projects, total] = await Promise.all([
    Project.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('createdBy', 'firstName lastName'),
    Project.countDocuments(query),
  ]);
  
  res.json({
    success: true,
    data: {
      projects,
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
 * Get single project
 * GET /api/v1/projects/:id
 */
export const getProject = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || id === 'undefined' || !mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid project ID', 400);
  }

  const project = await Project.findOne({
    _id: id,
    tenantId: req.tenantId,
  }).populate('createdBy', 'firstName lastName');
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  res.json({
    success: true,
    data: { project },
  });
});

/**
 * Update project
 * PUT /api/v1/projects/:id
 */
export const updateProject = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { name, description, domain, settings, branding, status, chatbot } = req.body;
  
  const project = await Project.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId },
    {
      name,
      description,
      domain,
      settings,
      branding,
      status,
      chatbot,
      updatedBy: req.userId,
    },
    { new: true, runValidators: true }
  );
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  await AuditService.log(req, 'project.update', {
    type: 'Project',
    id: String(project._id),
    name: project.name
  });
  
  res.json({
    success: true,
    message: 'Project updated successfully',
    data: { project },
  });
});

/**
 * Delete project (soft delete)
 * DELETE /api/v1/projects/:id
 */
export const deleteProject = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const project = await Project.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId },
    { status: 'archived' },
    { new: true }
  );
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  await AuditService.log(req, 'project.archive', {
    type: 'Project',
    id: String(project._id),
    name: project.name
  });
  
  res.json({
    success: true,
    message: 'Project archived successfully',
  });
});

/**
 * Duplicate project
 * POST /api/v1/projects/:id/duplicate
 */
export const duplicateProject = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { newName, newSlug } = req.body;
  
  const originalProject = await Project.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  
  if (!originalProject) {
    throw new AppError('Project not found', 404);
  }
  
  // Check if new slug exists
  const existingProject = await Project.findOne({
    tenantId: req.tenantId,
    slug: newSlug.toLowerCase(),
  });
  
  if (existingProject) {
    throw new AppError('A project with this slug already exists', 400, 'DUPLICATE_SLUG');
  }
  
  // Create new project
  const newProject = await Project.create({
    tenantId: req.tenantId,
    name: newName || `${originalProject.name} (Copy)`,
    slug: newSlug.toLowerCase(),
    description: originalProject.description,
    settings: originalProject.settings,
    branding: originalProject.branding,
    chatbot: originalProject.chatbot,
    status: 'draft',
    createdBy: req.userId,
  });
  
  // Duplicate all content
  const contents = await Content.find({
    projectId: originalProject._id,
    isDeleted: false,
  });
  
  for (const content of contents) {
    await Content.create({
      projectId: newProject._id,
      tenantId: req.tenantId,
      type: content.type,
      name: content.name,
      slug: content.slug,
      status: 'draft',
      isDefault: content.isDefault,
      visibility: content.visibility,
      data: content.data,
      locale: content.locale,
      localizedData: content.localizedData,
      meta: content.meta,
      seo: content.seo,
      createdBy: req.userId,
    });
  }
  
  // Duplicate knowledge base
  const knowledge = await Knowledge.find({
    projectId: originalProject._id,
    status: 'active',
  });
  
  for (const kb of knowledge) {
    await Knowledge.create({
      projectId: newProject._id,
      tenantId: req.tenantId,
      question: kb.question,
      answer: kb.answer,
      category: kb.category,
      keywords: kb.keywords,
      variations: kb.variations,
      richAnswer: kb.richAnswer,
      status: 'active',
      priority: kb.priority,
      createdBy: req.userId,
    });
  }
  
  await AuditService.log(req, 'project.duplicate', {
    type: 'Project',
    id: String(newProject._id),
    name: newProject.name
  }, { sourceProjectId: String(originalProject._id) });
  
  res.status(201).json({
    success: true,
    message: 'Project duplicated successfully',
    data: { project: newProject },
  });
});

/**
 * Get project statistics
 * GET /api/v1/projects/:id/stats
 */
export const getProjectStats = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || id === 'undefined' || !mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid project ID', 400);
  }

  const project = await Project.findOne({
    _id: id,
    tenantId: req.tenantId,
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  // Get content counts by type
  const contentCounts = await Content.aggregate([
    {
      $match: {
        projectId: project._id,
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: '$type',
        total: { $sum: 1 },
        published: {
          $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] },
        },
        draft: {
          $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] },
        },
      },
    },
  ]);
  
  // Get knowledge base count
  const knowledgeCount = await Knowledge.countDocuments({
    projectId: project._id,
    status: 'active',
  });
  
  // Format response
  const stats = {
    content: contentCounts.reduce(
      (acc, item) => {
        acc[item._id] = {
          total: item.total,
          published: item.published,
          draft: item.draft,
        };
        return acc;
      },
      {} as Record<string, { total: number; published: number; draft: number }>
    ),
    totalContent: contentCounts.reduce((sum, item) => sum + item.total, 0),
    totalPublished: contentCounts.reduce((sum, item) => sum + item.published, 0),
    knowledgeBase: knowledgeCount,
  };
  
  res.json({
    success: true,
    data: { stats },
  });
});

/**
 * Generate preview token
 * GET /api/v1/projects/:id/preview-token
 */
export const generatePreviewToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { contentId } = req.query;
  
  const project = await Project.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  
  if (!project.settings.previewUrl) {
    throw new AppError('Preview URL is not configured for this project', 400);
  }
  
  // Generate short-lived token
  const token = jwt.sign(
    { 
      projectId: project._id,
      tenantId: req.tenantId,
      contentId,
      type: 'preview' 
    },
    config.jwt.secret,
    { expiresIn: '5m' }
  );
  
  const url = `${project.settings.previewUrl}?preview_token=${token}&content_id=${contentId || ''}`;
  
  await AuditService.log(req, 'project.preview_token', {
    type: 'Project',
    id: String(project._id),
    name: project.name
  }, { contentId: String(contentId || '') });
  
  res.json({
    success: true,
    data: {
      token,
      url,
      previewUrl: project.settings.previewUrl
    },
  });
});
