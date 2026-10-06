/**
 * Advanced GraphQL Resolvers
 * 
 * Implements filtering, sorting, pagination, and aggregations
 * for enterprise-grade content queries
 */

import { Content } from '../models/Content';
import { FilterQuery } from 'mongoose';

// Helper to build MongoDB filter from GraphQL where input
function buildMongoFilter(where: any): FilterQuery<any> {
  if (!where) return {};

  const filter: any = {};

  // Handle logical operators
  if (where.AND) {
    filter.$and = where.AND.map(buildMongoFilter);
  }
  if (where.OR) {
    filter.$or = where.OR.map(buildMongoFilter);
  }
  if (where.NOT) {
    filter.$not = buildMongoFilter(where.NOT);
  }

  // Handle field filters
  Object.keys(where).forEach((key) => {
    if (['AND', 'OR', 'NOT'].includes(key)) return;

    const value = where[key];
    if (!value) return;

    // String filters
    if (value.eq !== undefined) filter[key] = value.eq;
    if (value.ne !== undefined) filter[key] = { $ne: value.ne };
    if (value.in) filter[key] = { $in: value.in };
    if (value.nin) filter[key] = { $nin: value.nin };
    if (value.contains) filter[key] = { $regex: value.contains, $options: 'i' };
    if (value.startsWith) filter[key] = { $regex: `^${value.startsWith}`, $options: 'i' };
    if (value.endsWith) filter[key] = { $regex: `${value.endsWith}$`, $options: 'i' };
    if (value.regex) filter[key] = { $regex: value.regex, $options: 'i' };

    // Number/Date filters
    if (value.gt !== undefined) filter[key] = { ...filter[key], $gt: value.gt };
    if (value.gte !== undefined) filter[key] = { ...filter[key], $gte: value.gte };
    if (value.lt !== undefined) filter[key] = { ...filter[key], $lt: value.lt };
    if (value.lte !== undefined) filter[key] = { ...filter[key], $lte: value.lte };
  });

  return filter;
}

// Helper to build MongoDB sort from GraphQL orderBy input
function buildMongoSort(orderBy: any[]): any {
  if (!orderBy || orderBy.length === 0) return { createdAt: -1 };

  const sort: any = {};
  orderBy.forEach((order) => {
    Object.keys(order).forEach((key) => {
      sort[key] = order[key] === 'ASC' ? 1 : -1;
    });
  });

  return sort;
}

// Advanced resolvers
export const advancedResolvers = {
  Query: {
    // Advanced content query with filtering, sorting, pagination
    contents: async (_: any, args: any) => {
      const { where, orderBy, pagination } = args;

      const filter = buildMongoFilter(where);
      const sort = buildMongoSort(orderBy);
      const limit = pagination?.limit || 50;
      const offset = pagination?.offset || 0;

      const contents = await Content.find(filter)
        .sort(sort)
        .limit(limit)
        .skip(offset)
        .populate('createdBy', 'name email')
        .populate('updatedBy', 'name email');

      return contents;
    },

    // Cursor-based pagination query
    contentsConnection: async (_: any, args: any) => {
      const { where, orderBy, pagination } = args;

      const filter = buildMongoFilter(where);
      const sort = buildMongoSort(orderBy);
      const limit = pagination?.first || pagination?.last || 50;

      let query = Content.find(filter).sort(sort);

      // Handle cursor pagination
      if (pagination?.after) {
        const afterDoc = await Content.findById(pagination.after);
        if (afterDoc) {
          filter._id = { $gt: afterDoc._id };
        }
      }
      if (pagination?.before) {
        const beforeDoc = await Content.findById(pagination.before);
        if (beforeDoc) {
          filter._id = { $lt: beforeDoc._id };
        }
      }

      const contents = await query.limit(limit + 1);
      const hasMore = contents.length > limit;
      const nodes = hasMore ? contents.slice(0, -1) : contents;

      const edges = nodes.map((node) => ({
        node,
        cursor: node._id.toString(),
      }));

      const total = await Content.countDocuments(filter);

      return {
        edges,
        pageInfo: {
          hasNextPage: hasMore && !pagination?.before,
          hasPreviousPage: Boolean(pagination?.after || pagination?.before),
          startCursor: edges[0]?.cursor,
          endCursor: edges[edges.length - 1]?.cursor,
          total,
        },
        totalCount: total,
      };
    },

    // Aggregation query
    contentsAggregate: async (_: any, args: any) => {
      const { where } = args;
      const filter = buildMongoFilter(where);

      const [count, byType, byStatus, byLocale] = await Promise.all([
        Content.countDocuments(filter),
        Content.aggregate([
          { $match: filter },
          { $group: { _id: '$type', count: { $sum: 1 } } },
          { $project: { type: '$_id', count: 1, _id: 0 } },
        ]),
        Content.aggregate([
          { $match: filter },
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $project: { status: '$_id', count: 1, _id: 0 } },
        ]),
        Content.aggregate([
          { $match: filter },
          { $group: { _id: '$locale', count: { $sum: 1 } } },
          { $project: { locale: '$_id', count: 1, _id: 0 } },
        ]),
      ]);

      return {
        count,
        byType,
        byStatus,
        byLocale,
      };
    },

    // Full-text search
    searchContents: async (_: any, args: any) => {
      const { query, limit = 50, offset = 0 } = args;

      const contents = await Content.find({
        $text: { $search: query },
      })
        .limit(limit)
        .skip(offset)
        .sort({ score: { $meta: 'textScore' } });

      return contents;
    },

    // Get content by slug
    contentBySlug: async (_: any, args: any) => {
      const { slug, locale } = args;

      const filter: any = { slug };
      if (locale) filter.locale = locale;

      const content = await Content.findOne(filter)
        .populate('createdBy', 'name email')
        .populate('updatedBy', 'name email');

      return content;
    },

    // Get multiple contents by IDs
    contentsByIds: async (_: any, args: any) => {
      const { ids } = args;

      const contents = await Content.find({
        _id: { $in: ids },
      })
        .populate('createdBy', 'name email')
        .populate('updatedBy', 'name email');

      return contents;
    },
  },

  Mutation: {
    // Bulk publish
    bulkPublishContents: async (_: any, args: any, context: any) => {
      const { ids } = args;

      try {
        const result = await Content.updateMany(
          { _id: { $in: ids } },
          {
            $set: {
              status: 'published',
              publishedAt: new Date(),
              updatedBy: context.user._id,
            },
          }
        );

        return {
          success: true,
          count: result.modifiedCount,
          errors: [],
        };
      } catch (error: any) {
        return {
          success: false,
          count: 0,
          errors: [error.message],
        };
      }
    },

    // Bulk unpublish
    bulkUnpublishContents: async (_: any, args: any, context: any) => {
      const { ids } = args;

      try {
        const result = await Content.updateMany(
          { _id: { $in: ids } },
          {
            $set: {
              status: 'draft',
              updatedBy: context.user._id,
            },
            $unset: { publishedAt: 1 },
          }
        );

        return {
          success: true,
          count: result.modifiedCount,
          errors: [],
        };
      } catch (error: any) {
        return {
          success: false,
          count: 0,
          errors: [error.message],
        };
      }
    },

    // Bulk delete
    bulkDeleteContents: async (_: any, args: any) => {
      const { ids } = args;

      try {
        const result = await Content.deleteMany({
          _id: { $in: ids },
        });

        return {
          success: true,
          count: result.deletedCount,
          errors: [],
        };
      } catch (error: any) {
        return {
          success: false,
          count: 0,
          errors: [error.message],
        };
      }
    },

    // Bulk update
    bulkUpdateContents: async (_: any, args: any, context: any) => {
      const { ids, data } = args;

      try {
        const result = await Content.updateMany(
          { _id: { $in: ids } },
          {
            $set: {
              ...data,
              updatedBy: context.user._id,
              updatedAt: new Date(),
            },
          }
        );

        return {
          success: true,
          count: result.modifiedCount,
          errors: [],
        };
      } catch (error: any) {
        return {
          success: false,
          count: 0,
          errors: [error.message],
        };
      }
    },

    // Duplicate content
    duplicateContent: async (_: any, args: any, context: any) => {
      const { id } = args;

      const original = await Content.findById(id);
      if (!original) throw new Error('Content not found');

      const duplicate = new Content({
        ...original.toObject(),
        _id: undefined,
        name: `${original.name} (Copy)`,
        slug: `${original.slug}-copy`,
        status: 'draft',
        createdBy: context.user._id,
        updatedBy: context.user._id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await duplicate.save();
      return duplicate;
    },

    // Restore from version
    restoreContentVersion: async (_: any, args: any, context: any) => {
      const { id, version } = args;

      const content = await Content.findById(id);
      if (!content) throw new Error('Content not found');

      const versionData = content.versionHistory?.find((v: any) => v.version === version);
      if (!versionData) throw new Error('Version not found');

      // Save current state to version history
      content.versionHistory = content.versionHistory || [];
      content.versionHistory.push({
        version: (content.version || 0) + 1,
        data: content.data,
        localizedData: content.localizedData,
        status: content.status,
        changedBy: context.user._id,
        changedAt: new Date(),
        changeNote: `Restored from version ${version}`,
      });

      // Restore version data
      content.data = versionData.data;
      content.localizedData = versionData.localizedData;
      content.status = versionData.status;
      content.version = (content.version || 0) + 1;
      content.updatedBy = context.user._id;
      content.updatedAt = new Date();

      await content.save();
      return content;
    },
  },
};

export default advancedResolvers;
