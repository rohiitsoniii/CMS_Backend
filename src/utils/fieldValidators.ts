import { IFieldDefinition, FieldTypes, ValidationResult, ValidationErrorType } from '../types/fieldTypes';

/**
 * Field Validation Utilities
 * Validates field values against their field definitions
 */

/**
 * Validate a field value against its definition
 */
export const validateField = async (
  field: IFieldDefinition,
  value: any,
  locale?: string,
  context?: { tenantId: string; contentTypeId?: string }
): Promise<ValidationResult> => {
  const errors: string[] = [];

  // Skip validation for hidden or disabled fields
  if (field.hidden || field.disabled) {
    return { valid: true, errors: [] };
  }

  // Required check
  if (field.required && (value === undefined || value === null || value === '')) {
    errors.push(`${field.displayName} is required`);
    return { valid: false, errors };
  }

  // If value is empty and not required, skip further validation
  if (value === undefined || value === null || value === '') {
    return { valid: true, errors: [] };
  }

  // Type-specific validation
  switch (field.type) {
    case FieldTypes.TEXT:
      validateTextField(field, value, errors);
      break;

    case FieldTypes.NUMBER:
      validateNumberField(field, value, errors);
      break;

    case FieldTypes.BOOLEAN:
      validateBooleanField(field, value, errors);
      break;

    case FieldTypes.EMAIL:
      validateEmailField(field, value, errors);
      break;

    case FieldTypes.URL:
      validateUrlField(field, value, errors);
      break;

    case FieldTypes.DATETIME:
      validateDateTimeField(field, value, errors);
      break;

    case FieldTypes.SELECT:
    case FieldTypes.RADIO:
    case FieldTypes.CHECKBOX:
      validateSelectField(field, value, errors);
      break;

    case FieldTypes.SLUG:
      validateSlugField(field, value, errors);
      break;

    case FieldTypes.COLOR:
      validateColorField(field, value, errors);
      break;

    case FieldTypes.LOCATION:
      validateLocationField(field, value, errors);
      break;

    case FieldTypes.JSON:
      validateJsonField(field, value, errors);
      break;

    case FieldTypes.MEDIA:
      validateMediaField(field, value, errors);
      break;

    case FieldTypes.REFERENCE:
      validateReferenceField(field, value, errors);
      break;

    case FieldTypes.COMPONENT:
      validateComponentField(field, value, errors);
      break;

    case FieldTypes.RICHTEXT:
    case FieldTypes.MARKDOWN:
      validateRichTextField(field, value, errors);
      break;

    case FieldTypes.BLOCKS:
      validateBlocksField(field, value, errors);
      break;

    default:
      // Unknown field type, skip validation
      break;
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Text field validation
 */
function validateTextField(field: IFieldDefinition, value: any, errors: string[]): void {
  if (typeof value !== 'string') {
    errors.push(`${field.displayName} must be a string`);
    return;
  }

  const config = field.config as any;

  if (config.minLength !== undefined && value.length < config.minLength) {
    errors.push(`${field.displayName} must be at least ${config.minLength} characters`);
  }

  if (config.maxLength !== undefined && value.length > config.maxLength) {
    errors.push(`${field.displayName} must be at most ${config.maxLength} characters`);
  }

  if (config.regex) {
    try {
      const regex = new RegExp(config.regex);
      if (!regex.test(value)) {
        errors.push(`${field.displayName} format is invalid`);
      }
    } catch (e) {
      errors.push(`${field.displayName} has invalid regex pattern`);
    }
  }
}

/**
 * Number field validation
 */
function validateNumberField(field: IFieldDefinition, value: any, errors: string[]): void {
  const num = Number(value);
  
  if (isNaN(num)) {
    errors.push(`${field.displayName} must be a valid number`);
    return;
  }

  const config = field.config as any;

  if (config.min !== undefined && num < config.min) {
    errors.push(`${field.displayName} must be at least ${config.min}`);
  }

  if (config.max !== undefined && num > config.max) {
    errors.push(`${field.displayName} must be at most ${config.max}`);
  }

  if (config.precision !== undefined) {
    const decimals = (num.toString().split('.')[1] || '').length;
    if (decimals > config.precision) {
      errors.push(`${field.displayName} can have at most ${config.precision} decimal places`);
    }
  }
}

/**
 * Boolean field validation
 */
function validateBooleanField(field: IFieldDefinition, value: any, errors: string[]): void {
  if (typeof value !== 'boolean') {
    errors.push(`${field.displayName} must be true or false`);
  }
}

/**
 * Email field validation
 */
function validateEmailField(field: IFieldDefinition, value: any, errors: string[]): void {
  if (typeof value !== 'string') {
    errors.push(`${field.displayName} must be a string`);
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    errors.push(`${field.displayName} must be a valid email address`);
  }
}

/**
 * URL field validation
 */
function validateUrlField(field: IFieldDefinition, value: any, errors: string[]): void {
  if (typeof value !== 'string') {
    errors.push(`${field.displayName} must be a string`);
    return;
  }

  try {
    const url = new URL(value);
    const config = field.config as any;
    
    if (config.protocols && config.protocols.length > 0) {
      if (!config.protocols.includes(url.protocol.replace(':', ''))) {
        errors.push(`${field.displayName} must use one of these protocols: ${config.protocols.join(', ')}`);
      }
    }
  } catch (e) {
    errors.push(`${field.displayName} must be a valid URL`);
  }
}

/**
 * DateTime field validation
 */
function validateDateTimeField(field: IFieldDefinition, value: any, errors: string[]): void {
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    errors.push(`${field.displayName} must be a valid date/time`);
  }
}

/**
 * Select/Radio/Checkbox field validation
 */
function validateSelectField(field: IFieldDefinition, value: any, errors: string[]): void {
  const config = field.config as any;

  if (!config.options || !Array.isArray(config.options)) {
    errors.push(`${field.displayName} has no options defined`);
    return;
  }

  const validValues = config.options.map((opt: any) => opt.value);

  if (config.multiple) {
    if (!Array.isArray(value)) {
      errors.push(`${field.displayName} must be an array`);
      return;
    }

    const invalidValues = value.filter(v => !validValues.includes(v));
    if (invalidValues.length > 0) {
      errors.push(`${field.displayName} contains invalid values: ${invalidValues.join(', ')}`);
    }
  } else {
    if (!validValues.includes(value)) {
      errors.push(`${field.displayName} must be one of: ${validValues.join(', ')}`);
    }
  }
}

/**
 * Slug field validation
 */
function validateSlugField(field: IFieldDefinition, value: any, errors: string[]): void {
  if (typeof value !== 'string') {
    errors.push(`${field.displayName} must be a string`);
    return;
  }

  const config = field.config as any;
  const pattern = config.pattern || '^[a-z0-9-]+$';
  
  try {
    const regex = new RegExp(pattern);
    if (!regex.test(value)) {
      errors.push(`${field.displayName} must match pattern: ${pattern}`);
    }
  } catch (e) {
    errors.push(`${field.displayName} has invalid pattern`);
  }
}

/**
 * Color field validation
 */
function validateColorField(field: IFieldDefinition, value: any, errors: string[]): void {
  if (typeof value !== 'string') {
    errors.push(`${field.displayName} must be a string`);
    return;
  }

  const config = field.config as any;
  const format = config.format || 'hex';

  if (format === 'hex') {
    const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (!hexRegex.test(value)) {
      errors.push(`${field.displayName} must be a valid hex color (e.g., #FF5733)`);
    }
  } else if (format === 'rgb') {
    const rgbRegex = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/;
    if (!rgbRegex.test(value)) {
      errors.push(`${field.displayName} must be a valid RGB color (e.g., rgb(255, 87, 51))`);
    }
  }
}

/**
 * Location field validation
 */
function validateLocationField(field: IFieldDefinition, value: any, errors: string[]): void {
  if (typeof value !== 'object' || value === null) {
    errors.push(`${field.displayName} must be an object with lat and lng`);
    return;
  }

  if (typeof value.lat !== 'number' || typeof value.lng !== 'number') {
    errors.push(`${field.displayName} must have numeric lat and lng values`);
    return;
  }

  if (value.lat < -90 || value.lat > 90) {
    errors.push(`${field.displayName} latitude must be between -90 and 90`);
  }

  if (value.lng < -180 || value.lng > 180) {
    errors.push(`${field.displayName} longitude must be between -180 and 180`);
  }
}

/**
 * JSON field validation
 */
function validateJsonField(field: IFieldDefinition, value: any, errors: string[]): void {
  if (typeof value !== 'object' || value === null) {
    errors.push(`${field.displayName} must be a valid JSON object`);
    return;
  }

  // TODO: Implement JSON Schema validation if config.schema is provided
  const config = field.config as any;
  if (config.schema) {
    // Would use a library like ajv for JSON Schema validation
    // For now, just check it's an object
  }
}

/**
 * Media field validation
 */
function validateMediaField(field: IFieldDefinition, value: any, errors: string[]): void {
  const config = field.config as any;

  if (config.multiple) {
    if (!Array.isArray(value)) {
      errors.push(`${field.displayName} must be an array`);
      return;
    }

    if (config.maxFiles && value.length > config.maxFiles) {
      errors.push(`${field.displayName} can have at most ${config.maxFiles} files`);
    }

    // Each item should be a reference object
    for (const item of value) {
      if (!item._ref || !item._type) {
        errors.push(`${field.displayName} contains invalid media reference`);
        break;
      }
    }
  } else {
    if (!value._ref || !value._type) {
      errors.push(`${field.displayName} must be a valid media reference`);
    }
  }
}

/**
 * Reference field validation
 */
function validateReferenceField(field: IFieldDefinition, value: any, errors: string[]): void {
  const config = field.config as any;

  if (config.multiple) {
    if (!Array.isArray(value)) {
      errors.push(`${field.displayName} must be an array`);
      return;
    }

    // Each item should be a reference object
    for (const item of value) {
      if (!item._ref || !item._type) {
        errors.push(`${field.displayName} contains invalid reference`);
        break;
      }
    }
  } else {
    if (!value._ref || !value._type) {
      errors.push(`${field.displayName} must be a valid reference`);
    }
  }
}

/**
 * Component field validation
 */
function validateComponentField(field: IFieldDefinition, value: any, errors: string[]): void {
  const config = field.config as any;

  if (config.repeatable) {
    if (!Array.isArray(value)) {
      errors.push(`${field.displayName} must be an array`);
      return;
    }

    if (config.min && value.length < config.min) {
      errors.push(`${field.displayName} must have at least ${config.min} items`);
    }

    if (config.max && value.length > config.max) {
      errors.push(`${field.displayName} can have at most ${config.max} items`);
    }
  } else {
    if (typeof value !== 'object' || value === null) {
      errors.push(`${field.displayName} must be an object`);
    }
  }
}

/**
 * Rich text field validation
 */
function validateRichTextField(field: IFieldDefinition, value: any, errors: string[]): void {
  if (typeof value !== 'string') {
    errors.push(`${field.displayName} must be a string`);
    return;
  }

  const config = field.config as any;

  if (config.maxLength && value.length > config.maxLength) {
    errors.push(`${field.displayName} must be at most ${config.maxLength} characters`);
  }
}

/**
 * Blocks field validation
 */
function validateBlocksField(field: IFieldDefinition, value: any, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${field.displayName} must be an array`);
    return;
  }

  const config = field.config as any;

  if (config.min && value.length < config.min) {
    errors.push(`${field.displayName} must have at least ${config.min} blocks`);
  }

  if (config.max && value.length > config.max) {
    errors.push(`${field.displayName} can have at most ${config.max} blocks`);
  }

  // Each block should have a blockType
  for (const block of value) {
    if (!block.blockType) {
      errors.push(`${field.displayName} contains blocks without blockType`);
      break;
    }

    if (config.allowedBlocks && !config.allowedBlocks.includes(block.blockType)) {
      errors.push(`${field.displayName} contains invalid block type: ${block.blockType}`);
      break;
    }
  }
}

/**
 * Validate all fields in a content entry
 */
export const validateContentData = async (
  fields: IFieldDefinition[],
  data: Record<string, any>,
  localizedData: Record<string, Record<string, any>> = {},
  locale: string = 'en'
): Promise<{ valid: boolean; errors: Record<string, string[]> }> => {
  const allErrors: Record<string, string[]> = {};

  for (const field of fields) {
    let value: any;

    // Get value from localized or non-localized data
    if (field.localized) {
      value = localizedData[locale]?.[field.name];
    } else {
      value = data[field.name];
    }

    // Validate field
    const result = await validateField(field, value, locale);
    
    if (!result.valid) {
      allErrors[field.name] = result.errors;
    }
  }

  return {
    valid: Object.keys(allErrors).length === 0,
    errors: allErrors
  };
};

/**
 * Generate slug from text
 */
export const generateSlug = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
};

/**
 * Get default value for a field
 */
export const getFieldDefaultValue = (field: IFieldDefinition): any => {
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }

  // Type-based defaults
  switch (field.type) {
    case FieldTypes.TEXT:
    case FieldTypes.RICHTEXT:
    case FieldTypes.MARKDOWN:
    case FieldTypes.EMAIL:
    case FieldTypes.URL:
    case FieldTypes.SLUG:
    case FieldTypes.COLOR:
      return '';

    case FieldTypes.NUMBER:
      return 0;

    case FieldTypes.BOOLEAN:
      return false;

    case FieldTypes.SELECT:
    case FieldTypes.CHECKBOX:
      const config = field.config as any;
      return config.multiple ? [] : null;

    case FieldTypes.MEDIA:
    case FieldTypes.REFERENCE:
      const mediaConfig = field.config as any;
      return mediaConfig.multiple ? [] : null;

    case FieldTypes.BLOCKS:
      return [];

    case FieldTypes.COMPONENT:
      const compConfig = field.config as any;
      return compConfig.repeatable ? [] : {};

    case FieldTypes.JSON:
      return {};

    case FieldTypes.LOCATION:
      return { lat: 0, lng: 0 };

    default:
      return null;
  }
};
