import { Express } from 'express';
import * as fs from 'fs';
import * as path from 'path';

// For enterprise grade, we'd typically use swagger-autogen or zod-to-openapi
// Here we scaffold an OpenAPI 3.1 JSON definition representing the core headless payloads
export const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Enterprise Headless CMS API',
    description: 'REST API for accessing and managing your headless CMS content, schemas, and AI endpoints.',
    version: '1.0.0',
  },
  servers: [
    { url: '/api/v1', description: 'Primary API V1' }
  ],
  paths: {
    '/projects/{projectId}/content': {
      get: {
        summary: 'List Content',
        tags: ['Content'],
        parameters: [
           { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'Successful array response of generic content' }
        }
      },
      post: {
        summary: 'Create Content',
        tags: ['Content'],
        parameters: [
           { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
           content: { 'application/json': { schema: { type: 'object' } } }
        },
        responses: {
          201: { description: 'Content successfully created' }
        }
      }
    },
    '/auth/login': {
       post: {
          summary: 'User Login',
          tags: ['Auth'],
          requestBody: {
             content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string'} } } } }
          },
          responses: {
             200: { description: 'Returns a JWT token' }
          }
       }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    }
  },
  security: [
    { bearerAuth: [] }
  ]
};

export const generateOpenapiSpec = () => {
    // In a complete build-step, we'd introspect Express routes using a tool like express-oas-generator.
    // Here we generate the JSON blob.
    const outputPath = path.join(process.cwd(), 'openapi.json');
    fs.writeFileSync(outputPath, JSON.stringify(OPENAPI_SPEC, null, 2));
    return OPENAPI_SPEC;
};
