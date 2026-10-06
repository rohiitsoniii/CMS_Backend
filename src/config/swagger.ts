import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Router, Request, Response } from 'express';
import { config } from '../config/index.js';

const router = Router();

const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Headless CMS API',
      version: '3.0.0',
      description: `
## Authentication
All protected endpoints require a Bearer token in the Authorization header:
\`Authorization: Bearer <your_jwt_token>\`

## API Keys
For server-to-server communication, use API keys:
\`X-API-Key: <your_api_key>\`

## Rate Limits
- Default: 100 requests per minute
- API calls: Based on subscription plan

## Base URL
\`${config.nodeEnv === 'production' ? 'https://api.yourdomain.com' : `http://localhost:${config.port}`}/api/v1\`
      `,
      contact: {
        name: 'API Support',
        email: 'support@headlesscms.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: config.nodeEnv === 'production' 
          ? 'https://api.yourdomain.com/api/v1' 
          : `http://localhost:${config.port}/api/v1`,
        description: config.nodeEnv === 'production' ? 'Production Server' : 'Development Server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token from /auth/login endpoint'
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API Key for server-to-server communication'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string' },
            message: { type: 'string' }
          }
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
            message: { type: 'string' }
          }
        },
        Project: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            settings: { type: 'object' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        ContentType: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string' },
                  required: { type: 'boolean' }
                }
              }
            }
          }
        },
        Content: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            contentType: { type: 'string' },
            data: { type: 'object' },
            status: { type: 'string', enum: ['draft', 'published', 'archived'] }
          }
        }
      }
    },
    tags: [
      { name: 'Authentication', description: 'User login, registration, password management' },
      { name: 'Projects', description: 'Project management and configuration' },
      { name: 'Content Types', description: 'Content type schema definitions' },
      { name: 'Content', description: 'Content CRUD operations' },
      { name: 'Media', description: 'File and media management' },
      { name: 'Users & Team', description: 'Team management and roles' },
      { name: 'Billing', description: 'Subscription and payment management' },
      { name: 'Webhooks', description: 'Webhook configuration and logs' },
      { name: 'Analytics', description: 'Usage and performance analytics' },
      { name: 'Settings', description: 'Tenant and project settings' }
    ]
  },
  apis: [
    './routes/*.ts',
    './controllers/*.ts'
  ]
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

router.get('/swagger.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

router.use('/', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info .title { font-size: 2.5em }
    .swagger-ui .info .description { font-size: 1.1em; line-height: 1.5 }
  `,
  customSiteTitle: 'Headless CMS API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'list',
    filter: true,
    showExtensions: true,
    showCommonExtensions: true
  }
}));

export default router;
export { swaggerSpec };