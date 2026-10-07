import { Request, Response } from 'express';
import Component from '../models/Component';
import { IFieldDefinition } from '../types/fieldTypes';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/index.js';

/**
 * Component Controller
 * Handles CRUD operations for reusable components
 */

/**
 * @route   GET /api/v1/components
 * @desc    Get all components for a tenant
 * @access  Private
 */
export const getComponents = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user?.tenantId;
  const { category } = req.query;

  if (!tenantId) {
    throw new AppError('Unauthorized', 401);
  }

  let query: any = { tenantId };
  if (category) {
    query.category = category;
  }

  const components = await Component.find(query)
    .sort({ category: 1, name: 1 });

  // Group by category
  const grouped = components.reduce((acc: any, component) => {
    const cat = component.category || 'General';
    if (!acc[cat]) {
      acc[cat] = [];
    }
    acc[cat].push(component);
    return acc;
  }, {});

  res.json({
    success: true,
    data: {
      components,
      grouped,
      total: components.length
    }
  });
  return;
});

/**
 * @route   GET /api/v1/components/:apiId
 * @desc    Get single component by apiId
 * @access  Private
 */
export const getComponent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { apiId } = req.params;
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    throw new AppError('Unauthorized', 401);
  }

  const component = await Component.findOne({ tenantId, apiId });

  if (!component) {
    throw new AppError('Component not found', 404);
  }

  // Check if component is in use
  const isInUse = await (Component as any).isInUse(component._id);

  res.json({
    success: true,
    data: {
      component,
      isInUse
    }
  });
  return;
});

/**
 * @route   POST /api/v1/components
 * @desc    Create new component
 * @access  Private
 */
export const createComponent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { name, apiId, description, fields, icon, category, singleton } = req.body;
  const tenantId = req.user?.tenantId;
  const userId = req.user?._id;

  if (!tenantId || !userId) {
    throw new AppError('Unauthorized', 401);
  }

  // Validate required fields
  if (!name || !apiId || !fields || !Array.isArray(fields)) {
    throw new AppError('Missing required fields: name, apiId, fields', 400);
  }

  // Check if apiId already exists
  const exists = await (Component as any).apiIdExists(tenantId, apiId);
  if (exists) {
    throw new AppError(`Component with apiId "${apiId}" already exists`, 400);
  }

  // Validate fields array
  if (fields.length === 0) {
    throw new AppError('Component must have at least one field', 400);
  }

  // Add IDs to fields if not present
  const fieldsWithIds = fields.map((field: IFieldDefinition, index: number) => ({
    ...field,
    id: field.id || `field_${uuidv4()}`,
    position: field.position !== undefined ? field.position : index
  }));

  // Validate no nested components
  const hasComponentField = fieldsWithIds.some((f: IFieldDefinition) => f.type === 'component');
  if (hasComponentField) {
    throw new AppError('Components cannot contain other components', 400);
  }

  // Create component
  const component = new Component({
    tenantId,
    apiId,
    name,
    description,
    fields: fieldsWithIds,
    icon,
    category: category || 'General',
    singleton: singleton || false,
    createdBy: userId,
    updatedBy: userId
  });

  await component.save();

  res.status(201).json({
    success: true,
    message: 'Component created successfully',
    data: { component }
  });
  return;
});

/**
 * @route   PUT /api/v1/components/:apiId
 * @desc    Update component
 * @access  Private
 */
export const updateComponent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { apiId } = req.params;
  const { name, description, icon, category, singleton } = req.body;
  const tenantId = req.user?.tenantId;
  const userId = req.user?._id;

  if (!tenantId || !userId) {
    throw new AppError('Unauthorized', 401);
  }

  const component = await Component.findOne({ tenantId, apiId });

  if (!component) {
    throw new AppError('Component not found', 404);
  }

  // Update fields
  if (name) component.name = name;
  if (description !== undefined) component.description = description;
  if (icon !== undefined) component.icon = icon;
  if (category !== undefined) component.category = category;
  if (singleton !== undefined) component.singleton = singleton;

  component.updatedBy = userId;
  await component.save();

  res.json({
    success: true,
    message: 'Component updated successfully',
    data: { component }
  });
  return;
});

/**
 * @route   DELETE /api/v1/components/:apiId
 * @desc    Delete component
 * @access  Private
 */
export const deleteComponent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { apiId } = req.params;
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    throw new AppError('Unauthorized', 401);
  }

  const component = await Component.findOne({ tenantId, apiId });

  if (!component) {
    throw new AppError('Component not found', 404);
  }

  // Check if component is in use
  const isInUse = await (Component as any).isInUse(component._id);
  if (isInUse) {
    throw new AppError('Cannot delete component that is in use. Remove it from all content types first.', 400);
  }

  await component.deleteOne();

  res.json({
    success: true,
    message: 'Component deleted successfully'
  });
  return;
});

/**
 * @route   POST /api/v1/components/:apiId/fields
 * @desc    Add field to component
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

  const component = await Component.findOne({ tenantId, apiId });

  if (!component) {
    throw new AppError('Component not found', 404);
  }

  // Validate field
  if (!field.name || !field.type || !field.displayName) {
    throw new AppError('Field must have name, type, and displayName', 400);
  }

  // Prevent nested components
  if (field.type === 'component') {
    throw new AppError('Components cannot contain other components', 400);
  }

  // Check if field name already exists
  if ((component as any).hasField(field.name)) {
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
    position: field.position !== undefined ? field.position : component.fields.length
  };

  component.fields.push(newField);
  component.updatedBy = userId;
  await component.save();

  res.status(201).json({
    success: true,
    message: 'Field added successfully',
    data: { field: newField, component }
  });
  return;
});

/**
 * @route   PUT /api/v1/components/:apiId/fields/:fieldId
 * @desc    Update field in component
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

  const component = await Component.findOne({ tenantId, apiId });

  if (!component) {
    throw new AppError('Component not found', 404);
  }

  // Find field
  const fieldIndex = component.fields.findIndex(f => f.id === fieldId);
  if (fieldIndex === -1) {
    throw new AppError('Field not found', 404);
  }

  // Prevent changing to component type
  if (updates.type === 'component') {
    throw new AppError('Components cannot contain other components', 400);
  }

  // Update field
  const field = component.fields[fieldIndex];
  Object.assign(field, updates);

  component.updatedBy = userId;
  await component.save();

  res.json({
    success: true,
    message: 'Field updated successfully',
    data: { field, component }
  });
  return;
});

/**
 * @route   DELETE /api/v1/components/:apiId/fields/:fieldId
 * @desc    Delete field from component
 * @access  Private
 */
export const deleteField = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { apiId, fieldId } = req.params;
  const tenantId = req.user?.tenantId;
  const userId = req.user?._id;

  if (!tenantId || !userId) {
    throw new AppError('Unauthorized', 401);
  }

  const component = await Component.findOne({ tenantId, apiId });

  if (!component) {
    throw new AppError('Component not found', 404);
  }

  // Find field
  const fieldIndex = component.fields.findIndex(f => f.id === fieldId);
  if (fieldIndex === -1) {
    throw new AppError('Field not found', 404);
  }

  // Remove field
  component.fields.splice(fieldIndex, 1);
  component.updatedBy = userId;
  await component.save();

  res.json({
    success: true,
    message: 'Field deleted successfully',
    data: { component }
  });
  return;
});

/**
 * @route   PUT /api/v1/components/:apiId/fields/reorder
 * @desc    Reorder fields in component
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

  const component = await Component.findOne({ tenantId, apiId });

  if (!component) {
    throw new AppError('Component not found', 404);
  }

  // Reorder fields
  const reorderedFields: IFieldDefinition[] = [];
  for (let i = 0; i < fieldOrder.length; i++) {
    const field = component.fields.find(f => f.id === fieldOrder[i]);
    if (field) {
      field.position = i;
      reorderedFields.push(field);
    }
  }

  // Add any fields not in the order array at the end
  const remainingFields = component.fields.filter(
    f => !fieldOrder.includes(f.id)
  );
  remainingFields.forEach((field, index) => {
    field.position = reorderedFields.length + index;
    reorderedFields.push(field);
  });

  component.fields = reorderedFields;
  component.updatedBy = userId;
  await component.save();

  res.json({
    success: true,
    message: 'Fields reordered successfully',
    data: { component }
  });
  return;
});

/**
 * @route   GET /api/v1/components/:id/usage
 * @desc    Get usage information for a component
 * @access  Private
 */
export const getComponentUsage = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    throw new AppError('Unauthorized', 401);
  }

  const component = await Component.findById(id);

  if (!component || component.tenantId.toString() !== tenantId.toString()) {
    throw new AppError('Component not found', 404);
  }

  const isInUse = await (Component as any).isInUse(component._id);

  // TODO: Get detailed usage information
  // - Which content types use this component
  // - How many content entries use it
  // - Last used date

  res.json({
    success: true,
    data: {
      componentId: component._id,
      componentName: component.name,
      isInUse,
      // usedIn: [] // Array of content types
    }
  });
  return;
});
