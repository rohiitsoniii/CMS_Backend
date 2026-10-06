/**
 * Advanced GraphQL Schema with Filtering, Sorting, and Pagination
 * 
 * This enhances the GraphQL API with enterprise-grade query capabilities
 * similar to Contentful and Strapi
 */

export const advancedGraphQLSchema = `#graphql
  # Filtering input types
  input StringFilter {
    eq: String
    ne: String
    in: [String]
    nin: [String]
    contains: String
    startsWith: String
    endsWith: String
    regex: String
  }

  input NumberFilter {
    eq: Float
    ne: Float
    gt: Float
    gte: Float
    lt: Float
    lte: Float
    in: [Float]
    nin: [Float]
  }

  input DateFilter {
    eq: DateTime
    ne: DateTime
    gt: DateTime
    gte: DateTime
    lt: DateTime
    lte: DateTime
  }

  input BooleanFilter {
    eq: Boolean
    ne: Boolean
  }

  # Content filtering
  input ContentWhereInput {
    id: StringFilter
    name: StringFilter
    slug: StringFilter
    type: StringFilter
    status: StringFilter
    locale: StringFilter
    createdAt: DateFilter
    updatedAt: DateFilter
    publishedAt: DateFilter
    
    # Logical operators
    AND: [ContentWhereInput]
    OR: [ContentWhereInput]
    NOT: ContentWhereInput
  }

  # Sorting
  enum SortOrder {
    ASC
    DESC
  }

  input ContentOrderByInput {
    id: SortOrder
    name: SortOrder
    createdAt: SortOrder
    updatedAt: SortOrder
    publishedAt: SortOrder
  }

  # Pagination
  input PaginationInput {
    limit: Int
    offset: Int
  }

  # Cursor-based pagination
  input CursorPaginationInput {
    first: Int
    after: String
    last: Int
    before: String
  }

  # Response with pagination info
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
    total: Int!
  }

  type ContentEdge {
    node: Content!
    cursor: String!
  }

  type ContentConnection {
    edges: [ContentEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  # Aggregation types
  type ContentAggregation {
    count: Int!
    byType: [TypeCount!]!
    byStatus: [StatusCount!]!
    byLocale: [LocaleCount!]!
  }

  type TypeCount {
    type: String!
    count: Int!
  }

  type StatusCount {
    status: String!
    count: Int!
  }

  type LocaleCount {
    locale: String!
    count: Int!
  }

  # Enhanced Query type
  type Query {
    # Advanced content query with filtering, sorting, pagination
    contents(
      where: ContentWhereInput
      orderBy: [ContentOrderByInput!]
      pagination: PaginationInput
    ): [Content!]!

    # Cursor-based pagination query
    contentsConnection(
      where: ContentWhereInput
      orderBy: [ContentOrderByInput!]
      pagination: CursorPaginationInput
    ): ContentConnection!

    # Aggregation query
    contentsAggregate(
      where: ContentWhereInput
    ): ContentAggregation!

    # Search query (full-text search)
    searchContents(
      query: String!
      limit: Int
      offset: Int
    ): [Content!]!

    # Get content by slug (common use case)
    contentBySlug(
      slug: String!
      locale: String
    ): Content

    # Get multiple contents by IDs
    contentsByIds(
      ids: [ID!]!
    ): [Content!]!
  }

  # Enhanced Mutation type
  type Mutation {
    # Bulk operations
    bulkPublishContents(ids: [ID!]!): BulkOperationResult!
    bulkUnpublishContents(ids: [ID!]!): BulkOperationResult!
    bulkDeleteContents(ids: [ID!]!): BulkOperationResult!
    bulkUpdateContents(
      ids: [ID!]!
      data: ContentUpdateInput!
    ): BulkOperationResult!

    # Duplicate content
    duplicateContent(id: ID!): Content!

    # Restore from version
    restoreContentVersion(
      id: ID!
      version: Int!
    ): Content!
  }

  type BulkOperationResult {
    success: Boolean!
    count: Int!
    errors: [String!]
  }

  # Subscription for real-time updates
  type Subscription {
    contentCreated(projectId: ID!): Content!
    contentUpdated(projectId: ID!, id: ID): Content!
    contentDeleted(projectId: ID!): ID!
    contentPublished(projectId: ID!): Content!
  }
`;

export default advancedGraphQLSchema;
