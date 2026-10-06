import { gql } from 'graphql-tag';

export const typeDefs = gql`
  scalar Date
  scalar JSON

  type Project {
    id: ID!
    name: String!
    slug: String!
    description: String
    status: String
    createdAt: Date
    updatedAt: Date
  }

  type RelatedContent {
    id: ID!
    name: String!
    slug: String
    type: String!
    status: String
    data: JSON
  }

  type Content {
    id: ID!
    projectId: ID!
    name: String!
    slug: String!
    type: String!
    data: JSON
    status: String
    version: Int
    relationships: JSON
    relatedContent(fieldName: String!): [RelatedContent]
    createdAt: Date
    updatedAt: Date
  }

  type Query {
    projects(status: String): [Project]
    project(id: ID!): Project
    
    contents(projectId: ID!, type: String, status: String, limit: Int, offset: Int): [Content]
    content(projectId: ID!, id: ID!): Content
  }

  input ContentInput {
    name: String!
    slug: String
    type: String!
    data: JSON!
    status: String
  }

  type Mutation {
    createContent(projectId: ID!, input: ContentInput!): Content
    updateContent(projectId: ID!, id: ID!, input: ContentInput!): Content
    deleteContent(projectId: ID!, id: ID!): Boolean
  }
`;
