import { Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { GridFSBucket, ObjectId } from 'mongodb';
import path from 'path';
import crypto from 'crypto';
import { MediaFile, Tenant } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { subscriptionPlans } from '../config/index.js';
import aiService from '../services/aiService.js';
import { getImageMetadata, transformImage, resolveImageVariant } from '../utils/imageProcessor.js';
import { escapeSearchTerm } from '../utils/queryBuilder.js';


// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/wav',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed: images, videos, audio, PDF, Word docs.'));
  }
};

// Multer upload middleware
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

// Get GridFS bucket
const getGridFSBucket = (): GridFSBucket => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new AppError('Database connection not established', 500);
  }
  return new GridFSBucket(db, { bucketName: 'media' });
};

/**
 * Upload file to GridFS
 * POST /api/v1/admin/media/upload
 */
export const uploadFile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }
  
  const tenant = await Tenant.findById(req.tenantId);
  if (!tenant) {
    throw new AppError('Tenant not found', 404);
  }
  
  // Check storage limit
  const planLimits = subscriptionPlans[tenant.subscription.plan]?.limits;
  if (planLimits && planLimits.storageBytes !== -1) {
    const newSize = tenant.usage.storageUsed + req.file.size;
    if (newSize > planLimits.storageBytes) {
      throw new AppError('Storage limit exceeded. Please upgrade your plan.', 403, 'STORAGE_LIMIT');
    }
  }
  
  const bucket = getGridFSBucket();
  
  // Generate unique filename
  const ext = path.extname(req.file.originalname);
  const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  
  // Upload to GridFS
  const uploadStream = bucket.openUploadStream(filename, {
    contentType: req.file.mimetype,
    metadata: {
      tenantId: req.tenantId,
      originalName: req.file.originalname,
      uploadedBy: req.userId,
    },
  });
  
  uploadStream.end(req.file.buffer);
  
  // Wait for upload to complete
  await new Promise<void>((resolve, reject) => {
    uploadStream.on('finish', () => resolve());
    uploadStream.on('error', (err) => reject(err));
  });
  
  // Note: In production, you'd use sharp or similar to get dimensions
  
  // Phase 5: AI Intelligence - Generate Alt Text and Tags
  let aiAlt = req.body.alt || '';
  let aiTags = req.body.tags ? req.body.tags.split(',').map((t: string) => t.trim()) : [];

  if (req.file.mimetype.startsWith('image/') && aiService.isConfigured()) {
    try {
      // Generate AI alt text if not provided
      if (!aiAlt) {
        aiAlt = await aiService.generateImageAltText(req.file.originalname, req.body.caption);
      }
      
      // Generate AI tags if not provided or to augment provided ones
      if (aiTags.length === 0) {
        aiTags = await aiService.generateTags(req.file.originalname + ' ' + (req.body.caption || ''), 5);
      }
    } catch (error) {
      console.error('AI Media Intelligence Error:', error);
      // Continue without AI if it fails
    }
  }

  
  // Extract real dimensions for images (best-effort; undefined otherwise)
  let dimensions: { width: number; height: number } | undefined = undefined;
  if (req.file.mimetype.startsWith('image/')) {
    try {
      const meta = await getImageMetadata(req.file.buffer);
      if (meta.width > 0 && meta.height > 0) {
        dimensions = { width: meta.width, height: meta.height };
      }
    } catch (error) {
      console.error('Failed to extract image dimensions:', error);
    }
  }

  // Create MediaFile record
  const mediaFile = await MediaFile.create({
    tenantId: req.tenantId,
    filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    storageType: 'gridfs',
    storageKey: uploadStream.id.toString(),
    url: buildPublicMediaUrl(uploadStream.id.toString()),
    dimensions,
    folder: req.body.folder || 'uploads',
    tags: aiTags,
    alt: aiAlt,
    caption: req.body.caption || '',

    isPublic: true,
    uploadedBy: req.userId,
  });
  
  // Update tenant storage usage
  await Tenant.updateOne(
    { _id: req.tenantId },
    { $inc: { 'usage.storageUsed': req.file.size } }
  );
  
  res.status(201).json({
    success: true,
    message: 'File uploaded successfully',
    data: { file: mediaFile },
  });
});

/**
 * Get all media files for tenant
 * GET /api/v1/admin/media
 */
export const getMediaFiles = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { folder, type, search, page = 1, limit = 20 } = req.query;
  
  const query: Record<string, unknown> = { tenantId: req.tenantId };
  
  if (folder) query.folder = folder;
  if (type) {
    const mimeTypes: Record<string, RegExp> = {
      image: /^image\//,
      video: /^video\//,
      audio: /^audio\//,
      document: /^application\/(pdf|msword|vnd\.)/,
    };
    if (mimeTypes[type as string]) {
      query.mimeType = mimeTypes[type as string];
    }
  }
  if (search && typeof search === 'string') {
    const term = escapeSearchTerm(search);
    query.$or = [
      { originalName: { $regex: term, $options: 'i' } },
      { alt: { $regex: term, $options: 'i' } },
      { tags: { $in: [new RegExp(term, 'i')] } },
    ];
  }
  
  const skip = (Number(page) - 1) * Number(limit);
  
  const [files, total] = await Promise.all([
    MediaFile.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('uploadedBy', 'firstName lastName'),
    MediaFile.countDocuments(query),
  ]);
  
  res.json({
    success: true,
    data: {
      files,
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
 * Get single media file
 * GET /api/v1/admin/media/:id
 */
export const getMediaFile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const file = await MediaFile.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  }).populate('uploadedBy', 'firstName lastName');
  
  if (!file) {
    throw new AppError('File not found', 404);
  }
  
  res.json({
    success: true,
    data: { file },
  });
});

/**
 * Update media file metadata
 * PUT /api/v1/admin/media/:id
 */
export const updateMediaFile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { alt, caption, tags, folder } = req.body;
  
  const file = await MediaFile.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId },
    {
      alt,
      caption,
      tags: tags ? tags.split(',').map((t: string) => t.trim()) : undefined,
      folder,
    },
    { new: true }
  );
  
  if (!file) {
    throw new AppError('File not found', 404);
  }
  
  res.json({
    success: true,
    message: 'File updated',
    data: { file },
  });
});

/**
 * Delete media file
 * DELETE /api/v1/admin/media/:id
 */
export const deleteMediaFile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const file = await MediaFile.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  
  if (!file) {
    throw new AppError('File not found', 404);
  }
  
  // Delete from GridFS
  if (file.storageType === 'gridfs') {
    const bucket = getGridFSBucket();
    try {
      await bucket.delete(new ObjectId(file.storageKey));
    } catch (err) {
      console.error('Failed to delete from GridFS:', err);
    }
  }
  
  // Update tenant storage
  await Tenant.updateOne(
    { _id: req.tenantId },
    { $inc: { 'usage.storageUsed': -file.size } }
  );
  
  // Delete record
  await MediaFile.deleteOne({ _id: file._id });
  
  res.json({
    success: true,
    message: 'File deleted',
  });
});

/**
 * Serve media file (public)
 * GET /api/v1/media/:id[?variant=thumb|small|medium|large&w=&h=&fit=]
 *
 * Images accept on-demand responsive variants (?variant= or ?w/?h/?fit=).
 * Non-images ignore transform params. When CDN_URL is set, uploads record
 * CDN-prefixed URLs (see buildPublicMediaUrl) and edge caches serve them.
 */
export const serveMediaFile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const isMongoId = mongoose.isValidObjectId(req.params.id);
  const file = await MediaFile.findOne({
    $or: [
      { storageKey: req.params.id },
      ...(isMongoId ? [{ _id: req.params.id }] : []),
      { filename: req.params.id }
    ]
  });

  if (!file) {
    throw new AppError('File not found', 404);
  }

  // Public serving route must not leak private files
  if (!file.isPublic) {
    throw new AppError('File is not public', 403);
  }

  if (file.storageType === 'gridfs') {
    const bucket = getGridFSBucket();

    // On-demand image variants (?variant= / ?w=&h=)
    if (file.mimeType.startsWith('image/')) {
      const transform = resolveImageVariant(req.query as Record<string, unknown>);
      if (transform) {
        const original = await gridfsToBuffer(bucket, file.storageKey);
        const result = await transformImage(original, transform);
        res.set('Content-Type', mimeForImageFormat(result.metadata.format));
        res.set('Content-Length', result.size.toString());
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(result.buffer);
        return;
      }
    }

    const downloadStream = bucket.openDownloadStream(new ObjectId(file.storageKey));

    res.set('Content-Type', file.mimeType);
    res.set('Content-Length', file.size.toString());
    res.set('Cache-Control', 'public, max-age=31536000'); // 1 year cache

    downloadStream.pipe(res);

    downloadStream.on('error', () => {
      res.status(404).json({
        success: false,
        error: 'File not found in storage',
      });
    });
  } else {
    throw new AppError('Storage type not supported', 500);
  }
});

/**
 * Public URL for a media file. When CDN_URL is configured (e.g. CloudFront),
 * uploads record CDN-prefixed URLs so reads bypass the API entirely.
 */
export const buildPublicMediaUrl = (storageId: string): string => {
  const cdn = (process.env.CDN_URL || '').replace(/\/$/, '');
  if (cdn) return `${cdn}/media/${storageId}`;
  return `/api/v1/media/${storageId}`;
};

const mimeForImageFormat = (format: string): string => {
  switch (format.toLowerCase()) {
    case 'jpeg':
    case 'jpg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
};

const gridfsToBuffer = async (bucket: GridFSBucket, storageKey: string): Promise<Buffer> => {
  try {
    const stream = bucket.openDownloadStream(new ObjectId(storageKey));
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  } catch {
    throw new AppError('File not found in storage', 404);
  }
};

/**
 * Get folders list
 * GET /api/v1/admin/media/folders
 */
export const getMediaFolders = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const folders = await MediaFile.distinct('folder', { tenantId: req.tenantId });
  
  // Get count per folder
  const folderCounts = await MediaFile.aggregate([
    { $match: { tenantId: new mongoose.Types.ObjectId(req.tenantId) } },
    { $group: { _id: '$folder', count: { $sum: 1 } } },
  ]);
  
  const foldersWithCount = folders.map(folder => ({
    name: folder,
    count: folderCounts.find(f => f._id === folder)?.count || 0,
  }));
  
  res.json({
    success: true,
    data: { folders: foldersWithCount },
  });
});

/**
 * Create a new folder
 * POST /api/v1/admin/media/folders
 */
export const createFolder = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { name } = req.body;
  
  if (!name || !name.trim()) {
    throw new AppError('Folder name is required', 400);
  }
  
  const folderName = name.trim().toLowerCase().replace(/\s+/g, '-');
  
  // Check if folder already exists
  const existingFolder = await MediaFile.findOne({
    tenantId: req.tenantId,
    folder: folderName,
  });
  
  if (existingFolder) {
    throw new AppError('Folder already exists', 409);
  }
  
  res.status(201).json({
    success: true,
    message: 'Folder created',
    data: { folder: { name: folderName, count: 0 } },
  });
});

/**
 * Rename a folder
 * PUT /api/v1/admin/media/folders/:name
 */
export const renameFolder = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { name: oldName } = req.params;
  const { newName } = req.body;
  
  if (!newName || !newName.trim()) {
    throw new AppError('New folder name is required', 400);
  }
  
  const newFolderName = newName.trim().toLowerCase().replace(/\s+/g, '-');
  
  // Check if new folder name already exists
  const existingFolder = await MediaFile.findOne({
    tenantId: req.tenantId,
    folder: newFolderName,
  });
  
  if (existingFolder) {
    throw new AppError('Folder with this name already exists', 409);
  }
  
  // Update all files in the folder
  const result = await MediaFile.updateMany(
    { tenantId: req.tenantId, folder: oldName },
    { $set: { folder: newFolderName } }
  );
  
  res.json({
    success: true,
    message: 'Folder renamed',
    data: { 
      folder: { name: newFolderName },
      filesUpdated: result.modifiedCount 
    },
  });
});

/**
 * Delete a folder (only if empty)
 * DELETE /api/v1/admin/media/folders/:name
 */
export const deleteFolder = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params;
  
  // Check if folder has files
  const fileCount = await MediaFile.countDocuments({
    tenantId: req.tenantId,
    folder: name,
  });
  
  if (fileCount > 0) {
    throw new AppError('Cannot delete folder with files. Please move or delete all files first.', 400);
  }
  
  res.json({
    success: true,
    message: 'Folder deleted',
  });
});

/**
 * Bulk delete files
 * POST /api/v1/admin/media/bulk-delete
 */
export const bulkDeleteFiles = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { fileIds } = req.body;
  
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    throw new AppError('File IDs array is required', 400);
  }
  
  // Find all files
  const files = await MediaFile.find({
    _id: { $in: fileIds },
    tenantId: req.tenantId,
  });
  
  if (files.length === 0) {
    throw new AppError('No files found', 404);
  }
  
  const bucket = getGridFSBucket();
  let totalSize = 0;
  
  // Delete from GridFS and calculate total size
  for (const file of files) {
    totalSize += file.size;
    
    if (file.storageType === 'gridfs') {
      try {
        await bucket.delete(new ObjectId(file.storageKey));
      } catch (err) {
        console.error(`Failed to delete file ${file._id} from GridFS:`, err);
      }
    }
  }
  
  // Delete records
  await MediaFile.deleteMany({
    _id: { $in: fileIds },
    tenantId: req.tenantId,
  });
  
  // Update tenant storage
  await Tenant.updateOne(
    { _id: req.tenantId },
    { $inc: { 'usage.storageUsed': -totalSize } }
  );
  
  res.json({
    success: true,
    message: `${files.length} file(s) deleted`,
    data: { deletedCount: files.length },
  });
});

/**
 * Bulk move files to a folder
 * POST /api/v1/admin/media/bulk-move
 */
export const bulkMoveFiles = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { fileIds, targetFolder } = req.body;
  
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    throw new AppError('File IDs array is required', 400);
  }
  
  if (!targetFolder || !targetFolder.trim()) {
    throw new AppError('Target folder is required', 400);
  }
  
  const folderName = targetFolder.trim().toLowerCase().replace(/\s+/g, '-');
  
  // Update all files
  const result = await MediaFile.updateMany(
    { 
      _id: { $in: fileIds },
      tenantId: req.tenantId 
    },
    { $set: { folder: folderName } }
  );
  
  res.json({
    success: true,
    message: `${result.modifiedCount} file(s) moved to ${folderName}`,
    data: { movedCount: result.modifiedCount },
  });
});
