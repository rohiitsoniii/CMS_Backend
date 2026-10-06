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
 * Build MongoDB query from filter parameters
 */
export const buildQuery = (filter: QueryFilter = {}): any => {
  const query: any = {};

  for (const [field, value] of Object.entries(filter)) {
    if (value === null || value === undefined) {
      continue;
    }

    // Handle nested fields (e.g., 'author.name')
    const fieldPath = field;

    // Check if value is an operator object
    if (isOperatorObject(value)) {
      query[fieldPath] = buildOperatorQuery(value);
    } else {
      // Direct value comparison
      query[fieldPath] = value;
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
const buildOperatorQuery = (operators: FilterOperator): any => {
  const query: any = {};

  // Equality operators
  if (operators.eq !== undefined) {
    return operators.eq;
  }

  if (operators.ne !== undefined) {
    query.$ne = operators.ne;
  }

  // Comparison operators
  if (operators.gt !== undefined) {
    query.$gt = operators.gt;
  }

  if (operators.gte !== undefined) {
    query.$gte = operators.gte;
  }

  if (operators.lt !== undefined) {
    query.$lt = operators.lt;
  }

  if (operators.lte !== undefined) {
    query.$lte = operators.lte;
  }

  // Array operators
  if (operators.in !== undefined) {
    query.$in = operators.in;
  }

  if (operators.nin !== undefined) {
    query.$nin = operators.nin;
  }

  // String operators
  if (operators.contains !== undefined) {
    query.$regex = new RegExp(escapeRegex(operators.contains), 'i');
  }

  if (operators.startsWith !== undefined) {
    query.$regex = new RegExp('^' + escapeRegex(operators.startsWith), 'i');
  }

  if (operators.endsWith !== undefined) {
    query.$regex = new RegExp(escapeRegex(operators.endsWith) + '$', 'i');
  }

  // Existence operator
  if (operators.exists !== undefined) {
    query.$exists = operators.exists;
  }

  // Regex operator
  if (operators.regex !== undefined) {
    query.$regex = new RegExp(operators.regex);
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
 * Build sort object from orderBy parameter
 */
export const buildSort = (orderBy?: string | string[]): any => {
  if (!orderBy) {
    return {};
  }

  const sort: any = {};
  const fields = Array.isArray(orderBy) ? orderBy : [orderBy];

  for (const field of fields) {
    if (field.startsWith('-')) {
      // Descending order
      sort[field.substring(1)] = -1;
    } else {
      // Ascending order
      sort[field] = 1;
    }
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
 * Build field selection
 */
export const buildSelect = (select?: string[]): string | undefined => {
  if (!select || select.length === 0) {
    return undefined;
  }

  return select.join(' ');
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
