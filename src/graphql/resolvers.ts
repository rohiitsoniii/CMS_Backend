import { Project } from '../models/Project.js';
import { Content } from '../models/Content.js';
import { GraphQLScalarType, Kind } from 'graphql';

const dateScalar = new GraphQLScalarType({
  name: 'Date',
  description: 'Date custom scalar type',
  serialize(value: any) {
    return value.getTime(); // Convert outgoing Date to timestamp
  },
  parseValue(value: any) {
    return new Date(value); // Convert incoming timestamp to Date
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.INT) {
      return new Date(parseInt(ast.value, 10)); // Convert hard-coded AST integer to Date
    }
    return null; // Invalid hard-coded value (not an integer)
  },
});

const jsonScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON custom scalar type',
  serialize(value: any) {
    return value;
  },
  parseValue(value: any) {
    return value;
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.OBJECT) {
      return parseObject(ast);
    }
    return null;
  },
});

function parseObject(ast: any) {
  const value: any = {};
  ast.fields.forEach((field: any) => {
    value[field.name.value] = parseValue(field.value);
  });
  return value;
}

function parseValue(ast: any) {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return parseFloat(ast.value);
    case Kind.OBJECT:
      return parseObject(ast);
    case Kind.LIST:
      return ast.values.map(parseValue);
    default:
      return null;
  }
}

export const resolvers = {
  Date: dateScalar,
  JSON: jsonScalar,

  Query: {
    projects: async (_: any, { status }: { status?: string }, context: any) => {
      if (!context.user || !context.tenantId) {
        throw new Error('Unauthorized');
      }
      const query: any = { tenantId: context.tenantId };
      if (status) query.status = status;
      return await Project.find(query).sort({ createdAt: -1 });
    },

    project: async (_: any, { id }: { id: string }, context: any) => {
      if (!context.user || !context.tenantId) {
        throw new Error('Unauthorized');
      }
      return await Project.findOne({ _id: id, tenantId: context.tenantId });
    },

    contents: async (_: any, { projectId, type, status, limit = 10, offset = 0 }: any, context: any) => {
      if (!context.user || !context.tenantId) {
        throw new Error('Unauthorized');
      }
      
      // Verify project belongs to tenant
      const project = await Project.findOne({ _id: projectId, tenantId: context.tenantId });
      if (!project) {
        throw new Error('Project not found');
      }

      const query: any = { projectId };
      if (type) query.type = type;
      if (status) query.status = status;

      return await Content.find(query)
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit);
    },

    content: async (_: any, { projectId, id }: { projectId: string, id: string }, context: any) => {
        if (!context.user || !context.tenantId) {
          throw new Error('Unauthorized');
        }
        return await Content.findOne({ _id: id, projectId });
    }
  },

  Content: {
    relatedContent: async (parent: any, { fieldName }: { fieldName: string }) => {
      if (!parent.relationships || !parent.relationships[fieldName]) {
        return [];
      }

      const relationshipIds = Array.isArray(parent.relationships[fieldName])
        ? parent.relationships[fieldName]
        : [parent.relationships[fieldName]];

      const relatedItems = await Content.find({
        _id: { $in: relationshipIds },
        isDeleted: false,
      }).select('_id name slug type status data');

      return relatedItems.map((item: any) => ({
        id: item._id,
        name: item.name,
        slug: item.slug,
        type: item.type,
        status: item.status,
        data: item.data,
      }));
    },
  },

  Mutation: {
    createContent: async (_: any, { projectId, input }: any, context: any) => {
      if (!context.user || !context.tenantId) {
        throw new Error('Unauthorized');
      }

      // Verify project ownership
      const project = await Project.findOne({ _id: projectId, tenantId: context.tenantId });
      if (!project) {
          throw new Error('Project not found');
      }

      const content = new Content({
        projectId,
        ...input,
        created_by: context.user.id,
        updated_by: context.user.id,
        // Default values if needed
        version: 1
      });

      return await content.save();
    },

    updateContent: async (_: any, { projectId, id, input }: any, context: any) => {
        if (!context.user || !context.tenantId) {
            throw new Error('Unauthorized');
        }

        const project = await Project.findOne({ _id: projectId, tenantId: context.tenantId });
        if (!project) throw new Error('Project not found');

        const content = await Content.findOneAndUpdate(
            { _id: id, projectId },
            { 
                ...input, 
                updatedAt: new Date(),
                updated_by: context.user.id
            },
            { new: true }
        );

        return content;
    },

    deleteContent: async (_: any, { projectId, id }: any, context: any) => {
        if (!context.user || !context.tenantId) {
            throw new Error('Unauthorized');
        }
        
        const project = await Project.findOne({ _id: projectId, tenantId: context.tenantId });
        if (!project) throw new Error('Project not found');

        const result = await Content.deleteOne({ _id: id, projectId });
        return result.deletedCount === 1;
    }
  }
};
