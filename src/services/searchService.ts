/**
 * Search Service using Elasticsearch
 * 
 * Provides advanced search capabilities:
 * - Full-text search
 * - Fuzzy search (typo tolerance)
 * - Faceted search
 * - Autocomplete
 * - Search analytics
 * - Multi-language search
 */

import { Client } from '@elastic/elasticsearch';
import { Content } from '../models/Content';

interface SearchOptions {
  query: string;
  filters?: {
    type?: string[];
    status?: string[];
    locale?: string[];
    tags?: string[];
    dateRange?: {
      field: string;
      from?: Date;
      to?: Date;
    };
  };
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
  page?: number;
  limit?: number;
  fuzzy?: boolean;
  highlight?: boolean;
}

interface SearchResult {
  total: number;
  hits: Array<{
    id: string;
    score: number;
    content: any;
    highlights?: any;
  }>;
  facets?: {
    types: Array<{ value: string; count: number }>;
    statuses: Array<{ value: string; count: number }>;
    tags: Array<{ value: string; count: number }>;
  };
  took: number;
}

class SearchService {
  private client: Client | null = null;
  private indexName = 'content';
  private isInitialized = false;

  /**
   * Initialize Elasticsearch client
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      this.client = new Client({
        node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
        auth: process.env.ELASTICSEARCH_AUTH
          ? {
              username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
              password: process.env.ELASTICSEARCH_PASSWORD || '',
            }
          : undefined,
      });

      // Test connection
      await this.client.ping();

      // Create index if it doesn't exist
      await this.createIndexIfNotExists();

      this.isInitialized = true;
      console.log('✅ Elasticsearch initialized');
    } catch (error) {
      console.error('❌ Elasticsearch initialization failed:', error);
      console.log('⚠️  Search service will use MongoDB fallback');
    }
  }

  /**
   * Create index with mappings
   */
  private async createIndexIfNotExists() {
    if (!this.client) return;

    try {
      const exists = await this.client.indices.exists({
        index: this.indexName,
      });

      if (!exists) {
        await this.client.indices.create({
          index: this.indexName,
          body: {
            settings: {
              analysis: {
                analyzer: {
                  content_analyzer: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase', 'asciifolding', 'stop', 'snowball'],
                  },
                },
              },
            },
            mappings: {
              properties: {
                projectId: { type: 'keyword' },
                type: { type: 'keyword' },
                name: {
                  type: 'text',
                  analyzer: 'content_analyzer',
                  fields: {
                    keyword: { type: 'keyword' },
                  },
                },
                slug: { type: 'keyword' },
                status: { type: 'keyword' },
                locale: { type: 'keyword' },
                data: { type: 'object', enabled: true },
                'meta.tags': { type: 'keyword' },
                'meta.category': { type: 'keyword' },
                'seo.metaTitle': {
                  type: 'text',
                  analyzer: 'content_analyzer',
                },
                'seo.metaDescription': {
                  type: 'text',
                  analyzer: 'content_analyzer',
                },
                createdAt: { type: 'date' },
                updatedAt: { type: 'date' },
                publishedAt: { type: 'date' },
              },
            },
          },
        });

        console.log(`✅ Created Elasticsearch index: ${this.indexName}`);
      }
    } catch (error) {
      console.error('Error creating index:', error);
    }
  }

  /**
   * Index a content document
   */
  async indexContent(content: any) {
    if (!this.client) return;

    try {
      await this.client.index({
        index: this.indexName,
        id: content._id.toString(),
        document: {
          projectId: content.projectId.toString(),
          type: content.type,
          name: content.name,
          slug: content.slug,
          status: content.status,
          locale: content.locale,
          data: content.data,
          meta: content.meta,
          seo: content.seo,
          createdAt: content.createdAt,
          updatedAt: content.updatedAt,
          publishedAt: content.publishedAt,
        },
      });

      console.log(`📇 Indexed content: ${content.name}`);
    } catch (error) {
      console.error('Error indexing content:', error);
    }
  }

  /**
   * Remove content from index
   */
  async removeContent(contentId: string) {
    if (!this.client) return;

    try {
      await this.client.delete({
        index: this.indexName,
        id: contentId,
      });

      console.log(`🗑️  Removed from index: ${contentId}`);
    } catch (error) {
      if (error.meta?.statusCode !== 404) {
        console.error('Error removing content:', error);
      }
    }
  }

  /**
   * Search content
   */
  async search(projectId: string, options: SearchOptions): Promise<SearchResult> {
    // If Elasticsearch is not available, use MongoDB fallback
    if (!this.client) {
      return this.mongoFallbackSearch(projectId, options);
    }

    try {
      const {
        query,
        filters = {},
        sort,
        page = 1,
        limit = 20,
        fuzzy = true,
        highlight = true,
      } = options;

      // Build query
      const must: any[] = [
        { term: { projectId } },
      ];

      // Add text search
      if (query) {
        must.push({
          multi_match: {
            query,
            fields: ['name^3', 'seo.metaTitle^2', 'seo.metaDescription', 'data.*'],
            fuzziness: fuzzy ? 'AUTO' : 0,
            prefix_length: 2,
          },
        });
      }

      // Build filters
      const filter: any[] = [];

      if (filters.type?.length) {
        filter.push({ terms: { type: filters.type } });
      }

      if (filters.status?.length) {
        filter.push({ terms: { status: filters.status } });
      }

      if (filters.locale?.length) {
        filter.push({ terms: { locale: filters.locale } });
      }

      if (filters.tags?.length) {
        filter.push({ terms: { 'meta.tags': filters.tags } });
      }

      if (filters.dateRange) {
        const range: any = {};
        if (filters.dateRange.from) range.gte = filters.dateRange.from;
        if (filters.dateRange.to) range.lte = filters.dateRange.to;
        filter.push({ range: { [filters.dateRange.field]: range } });
      }

      // Execute search
      const response = await this.client.search({
        index: this.indexName,
        body: {
          query: {
            bool: {
              must,
              filter,
            },
          },
          sort: sort
            ? [{ [sort.field]: { order: sort.order } }]
            : [{ _score: { order: 'desc' } }],
          from: (page - 1) * limit,
          size: limit,
          highlight: highlight
            ? {
                fields: {
                  name: {},
                  'seo.metaTitle': {},
                  'seo.metaDescription': {},
                },
                pre_tags: ['<mark>'],
                post_tags: ['</mark>'],
              }
            : undefined,
          aggs: {
            types: {
              terms: { field: 'type', size: 50 },
            },
            statuses: {
              terms: { field: 'status', size: 10 },
            },
            tags: {
              terms: { field: 'meta.tags', size: 50 },
            },
          },
        },
      });

      // Format results
      const hits = response.hits.hits.map((hit: any) => ({
        id: hit._id,
        score: hit._score,
        content: hit._source,
        highlights: hit.highlight,
      }));

      const facets = {
        types: response.aggregations?.types.buckets.map((b: any) => ({
          value: b.key,
          count: b.doc_count,
        })) || [],
        statuses: response.aggregations?.statuses.buckets.map((b: any) => ({
          value: b.key,
          count: b.doc_count,
        })) || [],
        tags: response.aggregations?.tags.buckets.map((b: any) => ({
          value: b.key,
          count: b.doc_count,
        })) || [],
      };

      return {
        total: response.hits.total.value,
        hits,
        facets,
        took: response.took,
      };
    } catch (error) {
      console.error('Search error:', error);
      // Fallback to MongoDB
      return this.mongoFallbackSearch(projectId, options);
    }
  }

  /**
   * Autocomplete suggestions
   */
  async autocomplete(projectId: string, query: string, limit: number = 10): Promise<string[]> {
    if (!this.client) {
      return this.mongoFallbackAutocomplete(projectId, query, limit);
    }

    try {
      const response = await this.client.search({
        index: this.indexName,
        body: {
          query: {
            bool: {
              must: [
                { term: { projectId } },
                {
                  multi_match: {
                    query,
                    fields: ['name^2', 'seo.metaTitle'],
                    type: 'bool_prefix',
                  },
                },
              ],
            },
          },
          _source: ['name'],
          size: limit,
        },
      });

      return response.hits.hits.map((hit: any) => hit._source.name);
    } catch (error) {
      console.error('Autocomplete error:', error);
      return this.mongoFallbackAutocomplete(projectId, query, limit);
    }
  }

  /**
   * MongoDB fallback search
   */
  private async mongoFallbackSearch(
    projectId: string,
    options: SearchOptions
  ): Promise<SearchResult> {
    const { query, filters = {}, sort, page = 1, limit = 20 } = options;

    const filter: any = { projectId };

    // Text search
    if (query) {
      filter.$text = { $search: query };
    }

    // Filters
    if (filters.type?.length) filter.type = { $in: filters.type };
    if (filters.status?.length) filter.status = { $in: filters.status };
    if (filters.locale?.length) filter.locale = { $in: filters.locale };
    if (filters.tags?.length) filter['meta.tags'] = { $in: filters.tags };

    const sortOptions: any = query ? { score: { $meta: 'textScore' } } : {};
    if (sort) sortOptions[sort.field] = sort.order === 'asc' ? 1 : -1;

    const [results, total] = await Promise.all([
      Content.find(filter)
        .sort(sortOptions)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Content.countDocuments(filter),
    ]);

    return {
      total,
      hits: results.map((r: any) => ({
        id: r._id.toString(),
        score: 1,
        content: r,
      })),
      took: 0,
    };
  }

  /**
   * MongoDB fallback autocomplete
   */
  private async mongoFallbackAutocomplete(
    projectId: string,
    query: string,
    limit: number
  ): Promise<string[]> {
    const results = await Content.find({
      projectId,
      name: { $regex: query, $options: 'i' },
    })
      .select('name')
      .limit(limit)
      .lean();

    return results.map((r: any) => r.name);
  }

  /**
   * Reindex all content
   */
  async reindexAll(projectId?: string) {
    if (!this.client) {
      console.log('⚠️  Elasticsearch not available, skipping reindex');
      return;
    }

    try {
      const filter: any = {};
      if (projectId) filter.projectId = projectId;

      const contents = await Content.find(filter).lean();

      for (const content of contents) {
        await this.indexContent(content);
      }

      console.log(`✅ Reindexed ${contents.length} content items`);
    } catch (error) {
      console.error('Reindex error:', error);
    }
  }

  /**
   * Check if Elasticsearch is available
   */
  isAvailable(): boolean {
    return this.isInitialized && this.client !== null;
  }
}

export default new SearchService();
