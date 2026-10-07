import { Request, Response } from 'express';
import mongoose from 'mongoose';
import ContentType from '../models/ContentType';
import { IFieldDefinition } from '../types/fieldTypes';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/index.js';

/**
 * ContentType Controller
 * Handles CRUD operations for content types
 */

/**
 * @route   GET /api/v1/content-types
 * @desc    Get all content types for a tenant
 * @access  Private
 */
export const getContentTypes = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    throw new AppError('Unauthorized', 401);
  }

  const contentTypes = await ContentType.find({ tenantId })
    .sort({ name: 1 })
    .select('-versionHistory');

  res.json({
    success: true,
    data: {
      contentTypes,
      total: contentTypes.length
    }
  });
  return;
});

/**
 * @route   GET /api/v1/content-types/:apiId
 * @desc    Get single content type by apiId or _id
 * @access  Private
 */
export const getContentType = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { apiId } = req.params;
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    throw new AppError('Unauthorized', 401);
  }

  const isObjectId = mongoose.Types.ObjectId.isValid(apiId);
  const contentType = await ContentType.findOne({
    tenantId,
    $or: [
      { apiId },
      ...(isObjectId ? [{ _id: apiId }] : []),
    ]
  });

  if (!contentType) {
    throw new AppError('Content type not found', 404);
  }

  res.json({
    success: true,
    data: { contentType }
  });
  return;
});

/**
 * @route   POST /api/v1/content-types
 * @desc    Create new content type
 * @access  Private
 */
export const createContentType = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { name, apiId, description, displayField, fields, icon, category } = req.body;
  const tenantId = req.user?.tenantId;
  const userId = req.user?._id;

  if (!tenantId || !userId) {
    throw new AppError('Unauthorized', 401);
  }

  const resolvedDisplayField = displayField || (Array.isArray(fields) && fields[0]?.name ? fields[0].name : 'title');

  // Validate required fields
  if (!name || !apiId || !resolvedDisplayField || !fields || !Array.isArray(fields)) {
    throw new AppError('Missing required fields: name, apiId, displayField, fields', 400);
  }

  // Check if apiId already exists
  const exists = await (ContentType as any).apiIdExists(tenantId, apiId);
  if (exists) {
    throw new AppError(`Content type with apiId "${apiId}" already exists`, 400);
  }

  // Validate fields array
  if (fields.length === 0) {
    throw new AppError('Content type must have at least one field', 400);
  }

  // Add IDs to fields if not present
  const fieldsWithIds = fields.map((field: any, index: number) => ({
    ...field,
    id: field.id || `field_${uuidv4()}`,
    displayName: field.displayName || field.label || field.name,
    label: field.label || field.displayName || field.name,
    position: field.position !== undefined ? field.position : index
  }));

  // Validate displayField exists
  const hasDisplayField = fieldsWithIds.some((f: IFieldDefinition) => f.name === resolvedDisplayField);
  if (!hasDisplayField) {
    throw new AppError(`Display field "${resolvedDisplayField}" must exist in fields`, 400);
  }

  // Create content type
  const contentType = new ContentType({
    tenantId,
    apiId,
    name,
    description,
    displayField: resolvedDisplayField,
    fields: fieldsWithIds,
    icon,
    category,
    isSystem: false,
    createdBy: userId,
    updatedBy: userId
  });

  await contentType.save();

  res.status(201).json({
    success: true,
    message: 'Content type created successfully',
    data: { contentType }
  });
  return;
});

/**
 * @route   PUT /api/v1/content-types/:apiId
 * @desc    Update content type
 * @access  Private
 */
export const updateContentType = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { apiId } = req.params;
  const { name, description, displayField, icon, category } = req.body;
  const tenantId = req.user?.tenantId;
  const userId = req.user?._id;

  if (!tenantId || !userId) {
    throw new AppError('Unauthorized', 401);
  }

  const contentType = await ContentType.findOne({ tenantId, apiId });

  if (!contentType) {
    throw new AppError('Content type not found', 404);
  }

  // Prevent updating system content types
  if (contentType.isSystem) {
    throw new AppError('Cannot update system content type', 403);
  }

  // Update fields
  if (name) contentType.name = name;
  if (description !== undefined) contentType.description = description;
  if (icon !== undefined) contentType.icon = icon;
  if (category !== undefined) contentType.category = category;

  if (displayField) {
    // Validate displayField exists
    const hasDisplayField = contentType.fields.some(f => f.name === displayField);
    if (!hasDisplayField) {
      throw new AppError(`Display field "${displayField}" must exist in fields`, 400);
    }
    contentType.displayField = displayField;
  }

  contentType.updatedBy = userId;
  await contentType.save();

  res.json({
    success: true,
    message: 'Content type updated successfully',
    data: { contentType }
  });
  return;
});

/**
 * @route   DELETE /api/v1/content-types/:apiId
 * @desc    Delete content type
 * @access  Private
 */
export const deleteContentType = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { apiId } = req.params;
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    throw new AppError('Unauthorized', 401);
  }

  const contentType = await ContentType.findOne({ tenantId, apiId });

  if (!contentType) {
    throw new AppError('Content type not found', 404);
  }

  // Prevent deleting system content types
  if (contentType.isSystem) {
    throw new AppError('Cannot delete system content type', 403);
  }

  // TODO: Check if content type has any content entries
  // If yes, prevent deletion or cascade delete based on policy

  await contentType.deleteOne();

  res.json({
    success: true,
    message: 'Content type deleted successfully'
  });
  return;
});

/**
 * @route   POST /api/v1/content-types/:apiId/fields
 * @desc    Add field to content type
 * @access  Private
 */
export const addField = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { apiId } = req.params;
  const field = req.body;
  const tenantId = req.user?.tenantId;
  const userId = req.user?._id;

  if (!tenantId || !userId) {
    throw new AppError('Unauthorized', 401);
  }

  const contentType = await ContentType.findOne({ tenantId, apiId });

  if (!contentType) {
    throw new AppError('Content type not found', 404);
  }

  if (contentType.isSystem) {
    throw new AppError('Cannot modify system content type', 403);
  }

  // Validate field
  if (!field.name || !field.type || !field.displayName) {
    throw new AppError('Field must have name, type, and displayName', 400);
  }

  // Check if field name already exists
  if ((contentType as any).hasField(field.name)) {
    throw new AppError(`Field "${field.name}" already exists`, 400);
  }

  // Add field
  const newField: IFieldDefinition = {
    id: field.id || `field_${uuidv4()}`,
    name: field.name,
    displayName: field.displayName,
    type: field.type,
    required: field.required || false,
    localized: field.localized || false,
    unique: field.unique || false,
    hidden: field.hidden || false,
    disabled: field.disabled || false,
    config: field.config || {},
    defaultValue: field.defaultValue,
    helpText: field.helpText,
    appearance: field.appearance,
    position: field.position !== undefined ? field.position : contentType.fields.length
  };

  contentType.fields.push(newField);
  contentType.updatedBy = userId;
  await contentType.save();

  res.status(201).json({
    success: true,
    message: 'Field added successfully',
    data: { field: newField, contentType }
  });
  return;
});

/**
 * @route   PUT /api/v1/content-types/:apiId/fields/:fieldId
 * @desc    Update field in content type
 * @access  Private
 */
export const updateField = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { apiId, fieldId } = req.params;
  const updates = req.body;
  const tenantId = req.user?.tenantId;
  const userId = req.user?._id;

  if (!tenantId || !userId) {
    throw new AppError('Unauthorized', 401);
  }

  const contentType = await ContentType.findOne({ tenantId, apiId });

  if (!contentType) {
    throw new AppError('Content type not found', 404);
  }

  if (contentType.isSystem) {
    throw new AppError('Cannot modify system content type', 403);
  }

  // Find field
  const fieldIndex = contentType.fields.findIndex(f => f.id === fieldId);
  if (fieldIndex === -1) {
    throw new AppError('Field not found', 404);
  }

  // Update field
  const field = contentType.fields[fieldIndex];
  Object.assign(field, updates);

  contentType.updatedBy = userId;
  await contentType.save();

  res.json({
    success: true,
    message: 'Field updated successfully',
    data: { field, contentType }
  });
  return;
});

/**
 * @route   DELETE /api/v1/content-types/:apiId/fields/:fieldId
 * @desc    Delete field from content type
 * @access  Private
 */
export const deleteField = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { apiId, fieldId } = req.params;
  const tenantId = req.user?.tenantId;
  const userId = req.user?._id;

  if (!tenantId || !userId) {
    throw new AppError('Unauthorized', 401);
  }

  const contentType = await ContentType.findOne({ tenantId, apiId });

  if (!contentType) {
    throw new AppError('Content type not found', 404);
  }

  if (contentType.isSystem) {
    throw new AppError('Cannot modify system content type', 403);
  }

  // Find field
  const fieldIndex = contentType.fields.findIndex(f => f.id === fieldId);
  if (fieldIndex === -1) {
    throw new AppError('Field not found', 404);
  }

  const field = contentType.fields[fieldIndex];

  // Prevent deleting display field
  if (field.name === contentType.displayField) {
    throw new AppError('Cannot delete display field. Change display field first.', 400);
  }

  // Remove field
  contentType.fields.splice(fieldIndex, 1);
  contentType.updatedBy = userId;
  await contentType.save();

  res.json({
    success: true,
    message: 'Field deleted successfully',
    data: { contentType }
  });
  return;
});

/**
 * @route   PUT /api/v1/content-types/:apiId/fields/reorder
 * @desc    Reorder fields in content type
 * @access  Private
 */
export const reorderFields = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { apiId } = req.params;
  const { fieldOrder } = req.body; // Array of field IDs in new order
  const tenantId = req.user?.tenantId;
  const userId = req.user?._id;

  if (!tenantId || !userId) {
    throw new AppError('Unauthorized', 401);
  }

  if (!Array.isArray(fieldOrder)) {
    throw new AppError('fieldOrder must be an array of field IDs', 400);
  }

  const contentType = await ContentType.findOne({ tenantId, apiId });

  if (!contentType) {
    throw new AppError('Content type not found', 404);
  }

  if (contentType.isSystem) {
    throw new AppError('Cannot modify system content type', 403);
  }

  // Reorder fields
  const reorderedFields: IFieldDefinition[] = [];
  for (let i = 0; i < fieldOrder.length; i++) {
    const field = contentType.fields.find(f => f.id === fieldOrder[i]);
    if (field) {
      field.position = i;
      reorderedFields.push(field);
    }
  }

  // Add any fields not in the order array at the end
  const remainingFields = contentType.fields.filter(
    f => !fieldOrder.includes(f.id)
  );
  remainingFields.forEach((field, index) => {
    field.position = reorderedFields.length + index;
    reorderedFields.push(field);
  });

  contentType.fields = reorderedFields;
  contentType.updatedBy = userId;
  await contentType.save();

  res.json({
    success: true,
    message: 'Fields reordered successfully',
    data: { contentType }
  });
  return;
});
