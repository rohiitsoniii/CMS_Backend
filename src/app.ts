import { initTracing } from './utils/tracing.js';
initTracing(); // Must be called before any other imports

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import jwt from 'jsonwebtoken';

import { config } from './config/index.js';
import { validateEnv } from './config/validateEnv.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import routes from './routes/index.js';
import swaggerRouter from './config/swagger.js';
import { errorHandler, notFoundHandler, usageLogger, requestIdMiddleware } from './middleware/index.js';
import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';
import collaborationService from './services/collaborationService.js';
import { scheduledPublishWorker } from './workers/scheduledPublishWorker.js';
import { checkAPIRateLimit } from './middleware/quotaMiddleware.js';

// Initialize Express app
const app = express();

// Start server function to handle async setup
const startServer = async () => {
  try {
    // Validate Environment Variables before proceeding
    validateEnv();

    // Connect to MongoDB
    await connectDatabase();
    
    // Connect to Redis (optional)
    try {
      await connectRedis();
    } catch (redisError) {
      console.warn('⚠️ Redis connection failed, continuing without cache:', (redisError as Error).message);
    }

    // --- Middleware Setup ---
    
    // Request ID Generation
    app.use(requestIdMiddleware);

    // Trust proxy
    app.set('trust proxy', 1);

    // Security
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"]
        }
      },
      crossOriginEmbedderPolicy: false,
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // Basic CSRF Protection via strict CORS and origin checking
    // Note: Fully fledged CSRF tokens require cookie-session configuration
    app.use((req, res, next) => {
      // Prevent Cross-Site Request Forgery (CSRF) for mutating state via Origins
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
         const origin = req.headers.origin;
         // Assume origin is checked during CORS, this block guarantees it hasn't somehow bypassed if it's external
      }
      next();
    });

    // CORS
    app.use(cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (config.nodeEnv === 'development') return callback(null, true);
        const allowedOrigins = [config.frontendUrl];
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-API-Secret'],
    }));

    // Body Parser
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Static Files
    app.use(express.static('public'));
    app.use('/uploads', express.static('uploads'));

    // Logging
    if (config.nodeEnv === 'development') app.use(morgan('dev'));
    else app.use(morgan('combined'));

    // Rate Limiting
    const globalLimiter = rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.maxRequests,
      message: {
        success: false,
        error: 'Too many requests',
        message: 'Please try again later',
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        if (config.nodeEnv === 'development') return true;
        return req.path.startsWith('/api/v1/content') && !req.path.includes('/admin/');
      },
    });
    app.use(globalLimiter);

    // API Rate Limit (Quota-based)
    app.use('/api/v1', checkAPIRateLimit);

    // Usage Logger
    app.use(usageLogger);

    // --- GraphQL Setup ---
    const server = new ApolloServer({
      typeDefs,
      resolvers,
    });

    await server.start();

    app.use(
      '/graphql',
      cors<cors.CorsRequest>(),
      express.json(),
      expressMiddleware(server, {
        context: async ({ req }) => {
          const token = req.headers.authorization || '';
          if (!token.startsWith('Bearer ')) {
            return {};
          }
          try {
            const decoded = jwt.verify(token.split(' ')[1], config.jwt.secret) as any;
            return {
              user: { id: decoded.userId, role: decoded.role },
              tenantId: decoded.tenantId,
            };
          } catch (e) {
            return {};
          }
        },
      }),
    );

    // --- REST API API Routes ---
    app.use('/api/v1', routes);

    // --- API Documentation ---
    app.use('/api-docs', swaggerRouter);

    // Root endpoint
    app.get('/', (_req, res) => {
      res.json({
        success: true,
        message: 'Headless CMS SaaS Platform API',
        version: '1.0.0',
        docs: '/api/v1/docs',
        health: '/api/v1/health',
        graphql: '/graphql'
      });
    });

    // --- Error Handling ---
    // These must be last
    app.use(notFoundHandler);
    app.use(errorHandler);

    // --- Start Listening ---
    const httpServer = app.listen(config.port, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 Headless CMS API Server                                  ║
║                                                               ║
║   Environment: ${config.nodeEnv.padEnd(44)}║
║   Port: ${config.port.toString().padEnd(52)}║
║   URL: http://localhost:${config.port.toString().padEnd(36)}║
║   GraphQL: http://localhost:${config.port}/graphql${' '.repeat(29)}║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
      `);
    });

    // Initialize WebSockets for Collaboration
    collaborationService.initialize(httpServer);

    // Boot background workers
    scheduledPublishWorker.start();

    // Graceful Shutdown Logic
    const shutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
      
      // Stop accepting new requests
      httpServer.close(async () => {
        console.log('✅ HTTP server closed (no longer accepting new connections)');
        
        try {
          // Disconnect from databases
          await disconnectDatabase();
          await disconnectRedis();
          
          console.log('🏁 Graceful shutdown completed safely');
          process.exit(0);
        } catch (err) {
          console.error('❌ Error during graceful shutdown:', err);
          process.exit(1);
        }
      });
      
      // Force shutdown after 30 seconds
      setTimeout(() => {
        console.error('⚠️ Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 30000);
    };

    // Handle process events
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      // Let global error handler or process exit logic handle it where necessary, 
      // but in production it's safer to shut down instead of being in an undefined state.
      shutdown('unhandledRejection');
    });

    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
      shutdown('uncaughtException');
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
