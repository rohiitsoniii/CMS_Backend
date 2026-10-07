import { Content } from '../models/Content';
import ContentType from '../models/ContentType';

/**
 * Reference Resolution Utility
 * Resolves references in content entries to specified depth
 */

interface ResolveOptions {
  depth?: number; // How deep to resolve (default: 1)
  maxDepth?: number; // Maximum depth allowed (default: 5)
  locale?: string; // Locale for localized content
  select?: string[]; // Fields to select
  populatedRefs?: Set<string>; // Track populated references (prevent circular)
}

/**
 * Resolve references in a content entry
 */
export const resolveReferences = async (
  entry: any,
  options: ResolveOptions = {}
): Promise<any> => {
  const {
    depth = 1,
    maxDepth = 5,
    locale = 'en',
    select,
    populatedRefs = new Set()
  } = options;

  // Stop if max depth reached
  if (depth > maxDepth) {
    return entry;
  }

  // Prevent circular references
  if (populatedRefs.has(entry._id.toString())) {
    return {
      _id: entry._id,
      _type: entry.contentTypeApiId || entry.type,
      _circular: true
    };
  }

  // Mark as populated
  populatedRefs.add(entry._id.toString());

  // Get content type schema
  let contentType;
  if (entry.contentTypeId) {
    contentType = await ContentType.findById(entry.contentTypeId);
  }

  if (!contentType) {
    return entry;
  }

  // Clone entry to avoid mutations
  const resolved = JSON.parse(JSON.stringify(entry.toObject ? entry.toObject() : entry));

  // Get reference fields from schema
  const referenceFields = contentType.fields.filter(
    f => f.type === 'reference' || f.type === 'media'
  );

  // Resolve each reference field
  for (const field of referenceFields) {
    const fieldValue = field.localized
      ? resolved.localizedData?.[locale]?.[field.name]
      : resolved.data?.[field.name];

    if (!fieldValue) continue;

    const config = field.config as any;
    const isMultiple = config.multiple;

    if (isMultiple && Array.isArray(fieldValue)) {
      // Resolve array of references
      const resolvedRefs = await Promise.all(
        fieldValue.map(ref => resolveReference(ref, depth, maxDepth, locale, select, populatedRefs))
      );

      if (field.localized) {
        if (!resolved.localizedData[locale]) resolved.localizedData[locale] = {};
        resolved.localizedData[locale][field.name] = resolvedRefs;
      } else {
        if (!resolved.data) resolved.data = {};
        resolved.data[field.name] = resolvedRefs;
      }
    } else if (fieldValue._ref) {
      // Resolve single reference
      const resolvedRef = await resolveReference(
        fieldValue,
        depth,
        maxDepth,
        locale,
        select,
        populatedRefs
      );

      if (field.localized) {
        if (!resolved.localizedData[locale]) resolved.localizedData[locale] = {};
        resolved.localizedData[locale][field.name] = resolvedRef;
      } else {
        if (!resolved.data) resolved.data = {};
        resolved.data[field.name] = resolvedRef;
      }
    }
  }

  return resolved;
};

/**
 * Resolve a single reference
 */
const resolveReference = async (
  ref: any,
  depth: number,
  maxDepth: number,
  locale: string,
  select?: string[],
  populatedRefs?: Set<string>
): Promise<any> => {
  if (!ref || !ref._ref) {
    return ref;
  }

  try {
    // Fetch referenced entry
    let query = Content.findById(ref._ref);

    // Apply field selection
    if (select && select.length > 0) {
      query = query.select(select.join(' '));
    }

    const referencedEntry = await query;

    if (!referencedEntry) {
      return {
        _ref: ref._ref,
        _type: ref._type,
        _notFound: true
      };
    }

    // If depth > 1, recursively resolve references
    if (depth > 1) {
      return await resolveReferences(referencedEntry, {
        depth: depth - 1,
        maxDepth,
        locale,
        select,
        populatedRefs
      });
    }

    // Return basic reference info
    return {
      _id: referencedEntry._id,
      _type: referencedEntry.contentTypeApiId || referencedEntry.type,
      ...getDisplayFields(referencedEntry, locale)
    };
  } catch (error) {
    console.error('Error resolving reference:', error);
    return {
      _ref: ref._ref,
      _type: ref._type,
      _error: true
    };
  }
};

/**
 * Get display fields from an entry
 */
const getDisplayFields = (entry: any, locale: string): any => {
  const fields: any = {};

  // Get content type to find display field
  if (entry.contentTypeId) {
    // For now, return common fields
    // In production, fetch content type and use displayField
    if (entry.localizedData?.[locale]) {
      const localized = entry.localizedData[locale];
      if (localized.title) fields.title = localized.title;
      if (localized.name) fields.name = localized.name;
    }

    if (entry.data) {
      if (entry.data.title) fields.title = entry.data.title;
      if (entry.data.name) fields.name = entry.data.name;
    }
  } else {
    // Legacy content
    fields.name = entry.name;
  }

  return fields;
};

/**
 * Batch resolve references for multiple entries
 */
export const batchResolveReferences = async (
  entries: any[],
  options: ResolveOptions = {}
): Promise<any[]> => {
  return await Promise.all(
    entries.map(entry => resolveReferences(entry, options))
  );
};

/**
 * Check for circular references
 */
export const hasCircularReference = (
  entry: any,
  targetId: string,
  visited: Set<string> = new Set()
): boolean => {
  if (!entry || !entry._id) return false;

  const entryId = entry._id.toString();

  if (entryId === targetId) return true;
  if (visited.has(entryId)) return false;

  visited.add(entryId);

  // Check all reference fields
  const checkReferences = (data: any): boolean => {
    if (!data) return false;

    for (const key in data) {
      const value = data[key];

      if (value && typeof value === 'object') {
        if (value._ref) {
          if (value._ref.toString() === targetId) return true;
        } else if (Array.isArray(value)) {
          for (const item of value) {
            if (item._ref && item._ref.toString() === targetId) return true;
          }
        }
      }
    }

    return false;
  };

  // Check both data and localizedData
  if (checkReferences(entry.data)) return true;

  if (entry.localizedData) {
    for (const locale in entry.localizedData) {
      if (checkReferences(entry.localizedData[locale])) return true;
    }
  }

  return false;
};

/**
 * Get all references from an entry
 */
export const extractReferences = (entry: any): string[] => {
  const refs: Set<string> = new Set();

  const extractFromData = (data: any) => {
    if (!data) return;

    for (const key in data) {
      const value = data[key];

      if (value && typeof value === 'object') {
        if (value._ref) {
          refs.add(value._ref.toString());
        } else if (Array.isArray(value)) {
          for (const item of value) {
            if (item._ref) {
              refs.add(item._ref.toString());
            }
          }
        }
      }
    }
  };

  // Extract from data
  extractFromData(entry.data);

  // Extract from localizedData
  if (entry.localizedData) {
    for (const locale in entry.localizedData) {
      extractFromData(entry.localizedData[locale]);
    }
  }

  return Array.from(refs);
};

/**
 * Validate references exist
 */
export const validateReferences = async (
  entry: any
): Promise<{ valid: boolean; missingRefs: string[] }> => {
  const refs = extractReferences(entry);
  const missingRefs: string[] = [];

  for (const refId of refs) {
    const exists = await Content.exists({ _id: refId });
    if (!exists) {
      missingRefs.push(refId);
    }
  }

  return {
    valid: missingRefs.length === 0,
    missingRefs
  };
};
