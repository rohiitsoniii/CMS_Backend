import { Request, Response } from 'express';
import Component, { IComponent } from '../models/Component';
import { IFieldDefinition } from '../types/fieldTypes';
import { v4 as uuidv4 } from 'uuid';

/**
 * Component Controller
 * Handles CRUD operations for reusable components
 */

/**
 * @route   GET /api/v1/components
 * @desc    Get all components for a tenant
 * @access  Private
 */
export const getComponents = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const { category } = req.query;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
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
  } catch (error: any) {
    console.error('Error fetching components:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch components',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/components/:apiId
 * @desc    Get single component by apiId
 * @access  Private
 */
export const getComponent = async (req: Request, res: Response) => {
  try {
    const { apiId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const component = await Component.findOne({ tenantId, apiId });

    if (!component) {
      return res.status(404).json({
        success: false,
        message: 'Component not found'
      });
    }

    // Check if component is in use
    const isInUse = await Component.isInUse(component._id);

    res.json({
      success: true,
      data: { 
        component,
        isInUse 
      }
    });
  } catch (error: any) {
    console.error('Error fetching component:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch component',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/components
 * @desc    Create new component
 * @access  Private
 */
export const createComponent = async (req: Request, res: Response) => {
  try {
    const { name, apiId, description, fields, icon, category, singleton } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Validate required fields
    if (!name || !apiId || !fields || !Array.isArray(fields)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, apiId, fields'
      });
    }

    // Check if apiId already exists
    const exists = await Component.apiIdExists(tenantId, apiId);
    if (exists) {
      return res.status(400).json({
        success: false,
        message: `Component with apiId "${apiId}" already exists`
      });
    }

    // Validate fields array
    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Component must have at least one field'
      });
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
      return res.status(400).json({
        success: false,
        message: 'Components cannot contain other components'
      });
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
  } catch (error: any) {
    console.error('Error creating component:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create component',
      error: error.message
    });
  }
};

/**
 * @route   PUT /api/v1/components/:apiId
 * @desc    Update component
 * @access  Private
 */
export const updateComponent = async (req: Request, res: Response) => {
  try {
    const { apiId } = req.params;
    const { name, description, icon, category, singleton } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const component = await Component.findOne({ tenantId, apiId });

    if (!component) {
      return res.status(404).json({
        success: false,
        message: 'Component not found'
      });
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
  } catch (error: any) {
    console.error('Error updating component:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update component',
      error: error.message
    });
  }
};

/**
 * @route   DELETE /api/v1/components/:apiId
 * @desc    Delete component
 * @access  Private
 */
export const deleteComponent = async (req: Request, res: Response) => {
  try {
    const { apiId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const component = await Component.findOne({ tenantId, apiId });

    if (!component) {
      return res.status(404).json({
        success: false,
        message: 'Component not found'
      });
    }

    // Check if component is in use
    const isInUse = await Component.isInUse(component._id);
    if (isInUse) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete component that is in use. Remove it from all content types first.'
      });
    }

    await component.deleteOne();

    res.json({
      success: true,
      message: 'Component deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting component:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete component',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/components/:apiId/fields
 * @desc    Add field to component
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

    const component = await Component.findOne({ tenantId, apiId });

    if (!component) {
      return res.status(404).json({
        success: false,
        message: 'Component not found'
      });
    }

    // Validate field
    if (!field.name || !field.type || !field.displayName) {
      return res.status(400).json({
        success: false,
        message: 'Field must have name, type, and displayName'
      });
    }

    // Prevent nested components
    if (field.type === 'component') {
      return res.status(400).json({
        success: false,
        message: 'Components cannot contain other components'
      });
    }

    // Check if field name already exists
    if (component.hasField(field.name)) {
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
 * @route   PUT /api/v1/components/:apiId/fields/:fieldId
 * @desc    Update field in component
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

    const component = await Component.findOne({ tenantId, apiId });

    if (!component) {
      return res.status(404).json({
        success: false,
        message: 'Component not found'
      });
    }

    // Find field
    const fieldIndex = component.fields.findIndex(f => f.id === fieldId);
    if (fieldIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Field not found'
      });
    }

    // Prevent changing to component type
    if (updates.type === 'component') {
      return res.status(400).json({
        success: false,
        message: 'Components cannot contain other components'
      });
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
 * @route   DELETE /api/v1/components/:apiId/fields/:fieldId
 * @desc    Delete field from component
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

    const component = await Component.findOne({ tenantId, apiId });

    if (!component) {
      return res.status(404).json({
        success: false,
        message: 'Component not found'
      });
    }

    // Find field
    const fieldIndex = component.fields.findIndex(f => f.id === fieldId);
    if (fieldIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Field not found'
      });
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
 * @route   PUT /api/v1/components/:apiId/fields/reorder
 * @desc    Reorder fields in component
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

    const component = await Component.findOne({ tenantId, apiId });

    if (!component) {
      return res.status(404).json({
        success: false,
        message: 'Component not found'
      });
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
  } catch (error: any) {
    console.error('Error reordering fields:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reorder fields',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/components/:id/usage
 * @desc    Get usage information for a component
 * @access  Private
 */
export const getComponentUsage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const component = await Component.findById(id);

    if (!component || component.tenantId.toString() !== tenantId.toString()) {
      return res.status(404).json({
        success: false,
        message: 'Component not found'
      });
    }

    const isInUse = await Component.isInUse(component._id);

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
  } catch (error: any) {
    console.error('Error fetching component usage:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch component usage',
      error: error.message
    });
  }
};
