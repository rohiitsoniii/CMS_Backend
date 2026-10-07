/**
 * Query Builder Utility
 * Builds MongoDB queries from API filter parameters
 */

export interface FilterOperator {
  eq?: any; // Equal
  ne?: any; // Not equal
  gt?: any; // Greater than
  gte?: any; // Greater than or equal
  lt?: any; // Less than
  lte?: any; // Less than or equal
  in?: any[]; // In array
  nin?: any[]; // Not in array
  contains?: string; // String contains (case-insensitive)
  startsWith?: string; // String starts with
  endsWith?: string; // String ends with
  exists?: boolean; // Field exists
  regex?: string; // Regular expression
}

export interface QueryFilter {
  [field: string]: FilterOperator | any;
}

export interface QueryOptions {
  where?: QueryFilter;
  orderBy?: string | string[]; // e.g., '-createdAt' or ['name', '-createdAt']
  limit?: number;
  skip?: number;
  select?: string[]; // Fields to include
  populate?: string[]; // Fields to populate
}

/**
 * Fields that must never appear in a client-built query — blocks MongoDB
 * operator injection ($where, $gt, ...) and prototype pollution.
 */
const FORBIDDEN_FIELD_PATTERN = /(^|\.)\$|^__proto__$|^constructor$|^prototype$|\.__proto__|constructor\.prototype/i;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Build MongoDB query from filter parameters.
 * Only allowlisted operator objects and primitive values are accepted —
 * arbitrary nested objects (e.g. {"$gt": ""}) are dropped.
 */
export const buildQuery = (filter: QueryFilter = {}): any => {
  const query: any = {};

  for (const [field, value] of Object.entries(filter)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof field !== 'string' || field.length > 128 || FORBIDDEN_FIELD_PATTERN.test(field)) {
      continue;
    }

    // Check if value is an operator object
    if (isOperatorObject(value)) {
      const built = buildOperatorQuery(value);
      if (built !== undefined && Object.keys(built).length > 0) {
        query[field] = built;
      }
    } else if (isPlainObject(value)) {
      // Non-operator objects are never passed through (NoSQL injection)
      continue;
    } else if (Array.isArray(value)) {
      // Arrays must be primitive-only
      if (value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))) {
        query[field] = value;
      }
    } else if (typeof value === 'string' && value.length > 1024) {
      continue;
    } else {
      // Direct primitive comparison
      query[field] = value;
    }
  }

  return query;
};

/**
 * Check if value is an operator object
 */
const isOperatorObject = (value: any): boolean => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const operators = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'startsWith', 'endsWith', 'exists', 'regex'];
  return Object.keys(value).some(key => operators.includes(key));
};

/**
 * Build MongoDB operator query
 */
/**
 * Build MongoDB operator query. All operand values are restricted to
 * primitives (or primitive arrays) so operator objects cannot smuggle
 * raw MongoDB operators like $where through operands.
 */
const asPrimitive = (value: unknown): string | number | boolean | null | undefined => {
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, 1024);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
};

const asPrimitiveArray = (value: unknown): Array<string | number | boolean | null> | undefined => {
  if (!Array.isArray(value) || value.length > 100) return undefined;
  const out: Array<string | number | boolean | null> = [];
  for (const v of value) {
    if (v === null) {
      out.push(null);
      continue;
    }
    if (typeof v === 'string' && v.length <= 1024) {
      out.push(v);
      continue;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.push(v);
      continue;
    }
    if (typeof v === 'boolean') {
      out.push(v);
      continue;
    }
    return undefined;
  }
  return out;
};

const buildOperatorQuery = (operators: FilterOperator): any => {
  const query: any = {};

  // Equality operators
  if (operators.eq !== undefined) {
    const prim = asPrimitive(operators.eq);
    if (prim === undefined) return {};
    return prim;
  }

  const setIfPrimitive = (key: string, value: unknown): void => {
    const prim = asPrimitive(value);
    if (prim !== undefined) query[key] = prim;
  };

  setIfPrimitive('$ne', operators.ne);

  // Comparison operators
  setIfPrimitive('$gt', operators.gt);
  setIfPrimitive('$gte', operators.gte);
  setIfPrimitive('$lt', operators.lt);
  setIfPrimitive('$lte', operators.lte);

  // Array operators
  if (operators.in !== undefined) {
    const arr = asPrimitiveArray(operators.in);
    if (arr) query.$in = arr;
  }

  if (operators.nin !== undefined) {
    const arr = asPrimitiveArray(operators.nin);
    if (arr) query.$nin = arr;
  }

  // String operators
  if (operators.contains !== undefined && typeof operators.contains === 'string') {
    query.$regex = new RegExp(escapeRegex(operators.contains.slice(0, 200)), 'i');
  }

  if (operators.startsWith !== undefined && typeof operators.startsWith === 'string') {
    query.$regex = new RegExp('^' + escapeRegex(operators.startsWith.slice(0, 200)), 'i');
  }

  if (operators.endsWith !== undefined && typeof operators.endsWith === 'string') {
    query.$regex = new RegExp(escapeRegex(operators.endsWith.slice(0, 200)) + '$', 'i');
  }

  // Existence operator
  if (operators.exists !== undefined) {
    query.$exists = operators.exists === true || (operators.exists as unknown) === 'true';
  }

  // Regex operator — escaped to a literal match (prevents ReDoS);
  // use contains/startsWith/endsWith for substring semantics.
  if (operators.regex !== undefined) {
    const pattern = String(operators.regex).slice(0, 100);
    query.$regex = new RegExp(escapeRegex(pattern), 'i');
  }

  return query;
};

/**
 * Escape special regex characters
 */
const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Sanitize a user-supplied search term for $regex use: coerces to string,
 * caps length (ReDoS protection), escapes metacharacters.
 */
export const escapeSearchTerm = (term: unknown, maxLength = 200): string =>
  escapeRegex(String(term ?? '').slice(0, maxLength));

const SAFE_PATH_PATTERN = /^[A-Za-z0-9_.]+$/;

/**
 * Build sort object from orderBy parameter. Rejects $ operators and
 * prototype-pollution paths.
 */
export const buildSort = (orderBy?: string | string[]): any => {
  if (!orderBy) {
    return {};
  }

  const sort: any = {};
  const fields = Array.isArray(orderBy) ? orderBy : [orderBy];

  for (const field of fields) {
    if (typeof field !== 'string' || field.length > 64) continue;
    const name = field.startsWith('-') ? field.substring(1) : field;
    if (!SAFE_PATH_PATTERN.test(name) || name.includes('$')) continue;
    sort[name] = field.startsWith('-') ? -1 : 1;
  }

  return sort;
};

/**
 * Build pagination options
 */
export const buildPagination = (options: QueryOptions): { limit?: number; skip?: number } => {
  const pagination: any = {};

  if (options.limit !== undefined) {
    pagination.limit = Math.min(options.limit, 1000); // Max 1000 items
  }

  if (options.skip !== undefined) {
    pagination.skip = options.skip;
  }

  return pagination;
};

/**
 * Build field selection. Only safe dotted paths are allowed.
 */
export const buildSelect = (select?: string[]): string | undefined => {
  if (!select || select.length === 0) {
    return undefined;
  }

  const safe = select.filter(
    (f) => typeof f === 'string' && f.length <= 64 && SAFE_PATH_PATTERN.test(f.replace(/^-/, '')) && !f.includes('$')
  );
  return safe.length > 0 ? safe.join(' ') : undefined;
};

/**
 * Parse query string parameters into QueryOptions
 */
export const parseQueryParams = (params: any): QueryOptions => {
  const options: QueryOptions = {};

  // Parse where clause
  if (params.where) {
    try {
      options.where = typeof params.where === 'string'
        ? JSON.parse(params.where)
        : params.where;
    } catch (e) {
      console.error('Error parsing where clause:', e);
    }
  }

  // Parse orderBy
  if (params.orderBy) {
    options.orderBy = Array.isArray(params.orderBy)
      ? params.orderBy
      : params.orderBy.split(',');
  }

  // Parse limit
  if (params.limit) {
    options.limit = parseInt(params.limit, 10);
  }

  // Parse skip
  if (params.skip) {
    options.skip = parseInt(params.skip, 10);
  }

  // Parse select
  if (params.select) {
    options.select = Array.isArray(params.select)
      ? params.select
      : params.select.split(',');
  }

  // Parse populate
  if (params.populate) {
    options.populate = Array.isArray(params.populate)
      ? params.populate
      : params.populate.split(',');
  }

  return options;
};

/**
 * Build full query with all options
 */
export const buildFullQuery = (options: QueryOptions) => {
  return {
    filter: buildQuery(options.where),
    sort: buildSort(options.orderBy),
    pagination: buildPagination(options),
    select: buildSelect(options.select)
  };
};

/**
 * Example usage:
 * 
 * // Simple equality
 * buildQuery({ status: 'published' })
 * // { status: 'published' }
 * 
 * // Comparison operators
 * buildQuery({ 
 *   publishDate: { gte: '2024-01-01', lte: '2024-12-31' }
 * })
 * // { publishDate: { $gte: '2024-01-01', $lte: '2024-12-31' } }
 * 
 * // String contains
 * buildQuery({ 
 *   'title': { contains: 'hello' }
 * })
 * // { title: { $regex: /hello/i } }
 * 
 * // In array
 * buildQuery({ 
 *   'categories._id': { in: ['cat1', 'cat2'] }
 * })
 * // { 'categories._id': { $in: ['cat1', 'cat2'] } }
 * 
 * // Nested fields
 * buildQuery({ 
 *   'author.name': { contains: 'John' }
 * })
 * // { 'author.name': { $regex: /John/i } }
 * 
 * // Multiple conditions
 * buildQuery({
 *   status: 'published',
 *   publishDate: { gte: '2024-01-01' },
 *   'author.name': { contains: 'John' }
 * })
 */

/**
 * Validate query options
 */
export const validateQueryOptions = (options: QueryOptions): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Validate limit
  if (options.limit !== undefined) {
    if (options.limit < 0) {
      errors.push('Limit must be a positive number');
    }
    if (options.limit > 1000) {
      errors.push('Limit cannot exceed 1000');
    }
  }

  // Validate skip
  if (options.skip !== undefined && options.skip < 0) {
    errors.push('Skip must be a positive number');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Build search query for full-text search
 */
export const buildSearchQuery = (searchTerm: string, fields: string[]): any => {
  if (!searchTerm || fields.length === 0) {
    return {};
  }

  const regex = new RegExp(escapeRegex(searchTerm), 'i');

  return {
    $or: fields.map(field => ({
      [field]: { $regex: regex }
    }))
  };
};

/**
 * Combine multiple queries with AND
 */
export const combineQueries = (...queries: any[]): any => {
  const validQueries = queries.filter(q => q && Object.keys(q).length > 0);

  if (validQueries.length === 0) {
    return {};
  }

  if (validQueries.length === 1) {
    return validQueries[0];
  }

  return { $and: validQueries };
};

/**
 * Combine multiple queries with OR
 */
export const combineQueriesOr = (...queries: any[]): any => {
  const validQueries = queries.filter(q => q && Object.keys(q).length > 0);

  if (validQueries.length === 0) {
    return {};
  }

  if (validQueries.length === 1) {
    return validQueries[0];
  }

  return { $or: validQueries };
};
