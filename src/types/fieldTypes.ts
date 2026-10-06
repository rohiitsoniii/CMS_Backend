/**
 * Field Types for Dynamic Content Schema
 * Defines all available field types and their configurations
 */

// Field Type Enum
export const FieldTypes = {
  // Basic Types
  TEXT: 'text',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  DATETIME: 'datetime',
  
  // Rich Content
  RICHTEXT: 'richText',
  MARKDOWN: 'markdown',
  
  // Selection
  SELECT: 'select',
  RADIO: 'radio',
  CHECKBOX: 'checkbox',
  
  // Media
  MEDIA: 'media',
  
  // References
  REFERENCE: 'reference',
  
  // Special
  SLUG: 'slug',
  EMAIL: 'email',
  URL: 'url',
  COLOR: 'color',
  LOCATION: 'location',
  JSON: 'json',
  
  // Advanced
  COMPONENT: 'component',
  BLOCKS: 'blocks',
} as const;

export type FieldType = typeof FieldTypes[keyof typeof FieldTypes];

// Field Configuration Interfaces
export interface TextFieldConfig {
  minLength?: number;
  maxLength?: number;
  regex?: string;
  multiline?: boolean;
  placeholder?: string;
}

export interface NumberFieldConfig {
  min?: number;
  max?: number;
  precision?: number; // Decimal places
  step?: number;
}

export interface SelectFieldConfig {
  options: Array<{ value: string; label: string }>;
  multiple?: boolean;
}

export interface MediaFieldConfig {
  accepts?: string[]; // MIME types: ['image/*', 'video/*']
  multiple?: boolean;
  maxFiles?: number;
  maxSize?: number; // In bytes
}

export interface ReferenceFieldConfig {
  refContentType: string; // Content type to reference
  multiple?: boolean;
  displayFields?: string[]; // Fields to show in picker
}

export interface SlugFieldConfig {
  source: string; // Field to generate slug from
  unique?: boolean;
  pattern?: string;
}

export interface ComponentFieldConfig {
  componentId: string;
  repeatable?: boolean;
  min?: number;
  max?: number;
}

export interface BlocksFieldConfig {
  allowedBlocks: string[]; // Component IDs
  min?: number;
  max?: number;
}

export interface RichTextFieldConfig {
  allowedBlocks?: string[]; // h1, h2, p, ul, ol, etc.
  allowEmbeds?: boolean;
  maxLength?: number;
}

export interface LocationFieldConfig {
  defaultZoom?: number;
  defaultCenter?: { lat: number; lng: number };
}

export interface JSONFieldConfig {
  schema?: object; // JSON Schema for validation
}

// Union type for all field configs
export type FieldConfig = 
  | TextFieldConfig
  | NumberFieldConfig
  | SelectFieldConfig
  | MediaFieldConfig
  | ReferenceFieldConfig
  | SlugFieldConfig
  | ComponentFieldConfig
  | BlocksFieldConfig
  | RichTextFieldConfig
  | LocationFieldConfig
  | JSONFieldConfig
  | Record<string, any>;

// Field Appearance Options
export type FieldAppearance = 'default' | 'dropdown' | 'radio' | 'checkbox' | 'toggle';

// Field Validation Result
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Field Definition Interface
export interface IFieldDefinition {
  id: string;
  name: string; // API name (camelCase)
  displayName: string; // UI display name
  type: FieldType;
  required: boolean;
  localized: boolean; // Can have different values per locale
  unique: boolean; // Must be unique across entries
  hidden: boolean; // Hide from UI
  disabled: boolean; // Read-only
  config: FieldConfig;
  defaultValue?: any;
  helpText?: string;
  appearance?: FieldAppearance;
  position: number; // Order in UI
}

// Validation Error Types
export enum ValidationErrorType {
  REQUIRED = 'REQUIRED',
  MIN_LENGTH = 'MIN_LENGTH',
  MAX_LENGTH = 'MAX_LENGTH',
  MIN_VALUE = 'MIN_VALUE',
  MAX_VALUE = 'MAX_VALUE',
  INVALID_FORMAT = 'INVALID_FORMAT',
  INVALID_TYPE = 'INVALID_TYPE',
  UNIQUE_VIOLATION = 'UNIQUE_VIOLATION',
  INVALID_REFERENCE = 'INVALID_REFERENCE',
}

export interface ValidationError {
  field: string;
  type: ValidationErrorType;
  message: string;
}
