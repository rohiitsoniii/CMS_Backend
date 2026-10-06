import { Request, Response } from 'express';
import mongoose from 'mongoose';
import ContentType, { IContentType } from '../models/ContentType';
import { IFieldDefinition } from '../types/fieldTypes';
import { v4 as uuidv4 } from 'uuid';

/**
 * ContentType Controller
 * Handles CRUD operations for content types
 */

/**
 * @route   GET /api/v1/content-types
 * @desc    Get all content types for a tenant
 * @access  Private
 */
export const getContentTypes = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
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
  } catch (error: any) {
    console.error('Error fetching content types:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch content types',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/content-types/:apiId
 * @desc    Get single content type by apiId or _id
 * @access  Private
 */
export const getContentType = async (req: Request, res: Response) => {
  try {
    const { apiId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
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
      return res.status(404).json({
        success: false,
        message: 'Content type not found'
      });
    }

    res.json({
      success: true,
      data: { contentType }
    });
  } catch (error: any) {
    console.error('Error fetching content type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch content type',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/content-types
 * @desc    Create new content type
 * @access  Private
 */
export const createContentType = async (req: Request, res: Response) => {
  try {
    const { name, apiId, description, displayField, fields, icon, category } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const resolvedDisplayField = displayField || (Array.isArray(fields) && fields[0]?.name ? fields[0].name : 'title');

    // Validate required fields
    if (!name || !apiId || !resolvedDisplayField || !fields || !Array.isArray(fields)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, apiId, displayField, fields'
      });
    }

    // Check if apiId already exists
    const exists = await ContentType.apiIdExists(tenantId, apiId);
    if (exists) {
      return res.status(400).json({
        success: false,
        message: `Content type with apiId "${apiId}" already exists`
      });
    }

    // Validate fields array
    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Content type must have at least one field'
      });
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
      return res.status(400).json({
        success: false,
        message: `Display field "${resolvedDisplayField}" must exist in fields`
      });
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
  } catch (error: any) {
    console.error('Error creating content type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create content type',
      error: error.message
    });
  }
};

/**
 * @route   PUT /api/v1/content-types/:apiId
 * @desc    Update content type
 * @access  Private
 */
export const updateContentType = async (req: Request, res: Response) => {
  try {
    const { apiId } = req.params;
    const { name, description, displayField, icon, category } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const contentType = await ContentType.findOne({ tenantId, apiId });

    if (!contentType) {
      return res.status(404).json({
        success: false,
        message: 'Content type not found'
      });
    }

    // Prevent updating system content types
    if (contentType.isSystem) {
      return res.status(403).json({
        success: false,
        message: 'Cannot update system content type'
      });
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
        return res.status(400).json({
          success: false,
          message: `Display field "${displayField}" must exist in fields`
        });
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
  } catch (error: any) {
    console.error('Error updating content type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update content type',
      error: error.message
    });
  }
};

/**
 * @route   DELETE /api/v1/content-types/:apiId
 * @desc    Delete content type
 * @access  Private
 */
export const deleteContentType = async (req: Request, res: Response) => {
  try {
    const { apiId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const contentType = await ContentType.findOne({ tenantId, apiId });

    if (!contentType) {
      return res.status(404).json({
        success: false,
        message: 'Content type not found'
      });
    }

    // Prevent deleting system content types
    if (contentType.isSystem) {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete system content type'
      });
    }

    // TODO: Check if content type has any content entries
    // If yes, prevent deletion or cascade delete based on policy

    await contentType.deleteOne();

    res.json({
      success: true,
      message: 'Content type deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting content type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete content type',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/content-types/:apiId/fields
 * @desc    Add field to content type
 * @access  Private
 */
export const addField = async (req: Request, res: Response) => {
  try {
    const { apiId } = req.params;
    const field = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const contentType = await ContentType.findOne({ tenantId, apiId });

    if (!contentType) {
      return res.status(404).json({
        success: false,
        message: 'Content type not found'
      });
    }

    if (contentType.isSystem) {
      return res.status(403).json({
        success: false,
        message: 'Cannot modify system content type'
      });
    }

    // Validate field
    if (!field.name || !field.type || !field.displayName) {
      return res.status(400).json({
        success: false,
        message: 'Field must have name, type, and displayName'
      });
    }

    // Check if field name already exists
    if (contentType.hasField(field.name)) {
      return res.status(400).json({
        success: false,
        message: `Field "${field.name}" already exists`
      });
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
  } catch (error: any) {
    console.error('Error adding field:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add field',
      error: error.message
    });
  }
};

/**
 * @route   PUT /api/v1/content-types/:apiId/fields/:fieldId
 * @desc    Update field in content type
 * @access  Private
 */
export const updateField = async (req: Request, res: Response) => {
  try {
    const { apiId, fieldId } = req.params;
    const updates = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const contentType = await ContentType.findOne({ tenantId, apiId });

    if (!contentType) {
      return res.status(404).json({
        success: false,
        message: 'Content type not found'
      });
    }

    if (contentType.isSystem) {
      return res.status(403).json({
        success: false,
        message: 'Cannot modify system content type'
      });
    }

    // Find field
    const fieldIndex = contentType.fields.findIndex(f => f.id === fieldId);
    if (fieldIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Field not found'
      });
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
  } catch (error: any) {
    console.error('Error updating field:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update field',
      error: error.message
    });
  }
};

/**
 * @route   DELETE /api/v1/content-types/:apiId/fields/:fieldId
 * @desc    Delete field from content type
 * @access  Private
 */
export const deleteField = async (req: Request, res: Response) => {
  try {
    const { apiId, fieldId } = req.params;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const contentType = await ContentType.findOne({ tenantId, apiId });

    if (!contentType) {
      return res.status(404).json({
        success: false,
        message: 'Content type not found'
      });
    }

    if (contentType.isSystem) {
      return res.status(403).json({
        success: false,
        message: 'Cannot modify system content type'
      });
    }

    // Find field
    const fieldIndex = contentType.fields.findIndex(f => f.id === fieldId);
    if (fieldIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Field not found'
      });
    }

    const field = contentType.fields[fieldIndex];

    // Prevent deleting display field
    if (field.name === contentType.displayField) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete display field. Change display field first.'
      });
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
  } catch (error: any) {
    console.error('Error deleting field:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete field',
      error: error.message
    });
  }
};

/**
 * @route   PUT /api/v1/content-types/:apiId/fields/reorder
 * @desc    Reorder fields in content type
 * @access  Private
 */
export const reorderFields = async (req: Request, res: Response) => {
  try {
    const { apiId } = req.params;
    const { fieldOrder } = req.body; // Array of field IDs in new order
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    if (!Array.isArray(fieldOrder)) {
      return res.status(400).json({
        success: false,
        message: 'fieldOrder must be an array of field IDs'
      });
    }

    const contentType = await ContentType.findOne({ tenantId, apiId });

    if (!contentType) {
      return res.status(404).json({
        success: false,
        message: 'Content type not found'
      });
    }

    if (contentType.isSystem) {
      return res.status(403).json({
        success: false,
        message: 'Cannot modify system content type'
      });
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
  } catch (error: any) {
    console.error('Error reordering fields:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reorder fields',
      error: error.message
    });
  }
};
