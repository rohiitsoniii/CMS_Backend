import ContentType from '../models/ContentType';
import { FieldTypes } from '../types/fieldTypes';
import { nanoid } from 'nanoid';

export interface TemplateField {
  name: string;
  displayName: string;
  type: string;
  required?: boolean;
  localized?: boolean;
  config?: any;
  position: number;
}

export interface TemplateContentType {
  apiId: string;
  name: string;
  description: string;
  displayField: string;
  fields: TemplateField[];
  icon?: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  contentTypes: TemplateContentType[];
}

const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'blog',
    name: 'Standard Blog',
    description: 'A complete blog setup with posts, categories, and authors.',
    category: 'Content',
    icon: '✍️',
    contentTypes: [
      {
        apiId: 'author',
        name: 'Author',
        description: 'Writer of the blog posts',
        displayField: 'name',
        icon: '👤',
        fields: [
          { id: nanoid(), name: 'name', displayName: 'Full Name', type: FieldTypes.TEXT, required: true, position: 0 },
          { id: nanoid(), name: 'bio', displayName: 'Biography', type: FieldTypes.RICHTEXT, position: 1 },
          { id: nanoid(), name: 'avatar', displayName: 'Avatar Image', type: FieldTypes.MEDIA, position: 2 },
        ] as any,
      },
      {
        apiId: 'category',
        name: 'Category',
        description: 'Blog categories',
        displayField: 'title',
        icon: '📁',
        fields: [
          { id: nanoid(), name: 'title', displayName: 'Title', type: FieldTypes.TEXT, required: true, position: 0 },
          { id: nanoid(), name: 'slug', displayName: 'Slug', type: FieldTypes.SLUG, config: { source: 'title' }, position: 1 },
        ] as any,
      },
      {
        apiId: 'post',
        name: 'Blog Post',
        description: 'Daily blog entries',
        displayField: 'title',
        icon: '📄',
        fields: [
          { id: nanoid(), name: 'title', displayName: 'Title', type: FieldTypes.TEXT, required: true, position: 0 },
          { id: nanoid(), name: 'slug', displayName: 'Slug', type: FieldTypes.SLUG, config: { source: 'title' }, position: 1 },
          { id: nanoid(), name: 'content', displayName: 'Content', type: FieldTypes.RICHTEXT, required: true, position: 2 },
          { id: nanoid(), name: 'featuredImage', displayName: 'Featured Image', type: FieldTypes.MEDIA, position: 3 },
          { id: nanoid(), name: 'author', displayName: 'Author', type: FieldTypes.REFERENCE, config: { refContentType: 'author' }, position: 4 },
          { id: nanoid(), name: 'categories', displayName: 'Categories', type: FieldTypes.REFERENCE, config: { refContentType: 'category', multiple: true }, position: 5 },
          { id: nanoid(), name: 'publishedAt', displayName: 'Publish Date', type: FieldTypes.DATETIME, position: 6 },
        ] as any,
      },
    ],
  },
  {
    id: 'ecommerce',
    name: 'E-commerce Store',
    description: 'Product catalog with variants, categories, and reviews.',
    category: 'Commerce',
    icon: '🛒',
    contentTypes: [
      {
        apiId: 'product',
        name: 'Product',
        description: 'Physical or digital items',
        displayField: 'name',
        icon: '📦',
        fields: [
          { id: nanoid(), name: 'name', displayName: 'Product Name', type: FieldTypes.TEXT, required: true, position: 0 },
          { id: nanoid(), name: 'sku', displayName: 'SKU', type: FieldTypes.TEXT, required: true, position: 1 },
          { id: nanoid(), name: 'price', displayName: 'Price', type: FieldTypes.NUMBER, required: true, position: 2 },
          { id: nanoid(), name: 'description', displayName: 'Description', type: FieldTypes.MARKDOWN, position: 3 },
          { id: nanoid(), name: 'images', displayName: 'Product Images', type: FieldTypes.MEDIA, config: { multiple: true }, position: 4 },
          { id: nanoid(), name: 'stock', displayName: 'Stock Level', type: FieldTypes.NUMBER, position: 5 },
        ] as any,
      },
    ],
  },
];

export class TemplateService {
  /**
   * List all available templates
   */
  static getTemplates() {
    return TEMPLATES.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      icon: t.icon,
    }));
  }

  /**
   * Apply a template to a project
   */
  static async applyTemplate(tenantId: string, projectId: string, templateId: string, userId: string) {
    const template = TEMPLATES.find(t => t.id === templateId);
    if (!template) throw new Error('Template not found');

    const results = [];

    // Order matters for references (though we handle it simply here)
    for (const ctTemplate of template.contentTypes) {
      // Create Content Type
      const contentType = await ContentType.create({
        tenantId,
        projectId, // Some models might need projectId if they have it
        apiId: ctTemplate.apiId,
        name: ctTemplate.name,
        description: ctTemplate.description,
        displayField: ctTemplate.displayField,
        fields: ctTemplate.fields,
        icon: ctTemplate.icon,
        createdBy: userId,
        updatedBy: userId,
      });

      results.push(contentType);
    }

    return results;
  }
}
