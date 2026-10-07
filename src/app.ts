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
import { errorHandler, notFoundHandler, usageLogger, requestIdMiddleware, sentryMiddleware, sentryErrorMiddleware } from './middleware/index.js';
import cookieParser from 'cookie-parser';
import { csrfProtection } from './middleware/cookies.js';
import { httpMetrics } from './middleware/httpMetrics.js';
import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';
import collaborationService from './services/collaborationService.js';
import { scheduledPublishWorker } from './workers/scheduledPublishWorker.js';
import { webhookRetryWorker } from './workers/webhookRetryWorker.js';
import { emailCampaignWorker } from './workers/emailCampaignWorker.js';
import { checkAPIRateLimit } from './middleware/quotaMiddleware.js';
import { aiContextMiddleware } from './services/aiGateway.js';
import { serveEmbedScript } from './utils/embedScripts.js';

// Initialize Express app
const app = express();

// Start server function to handle async setup
const startServer = async () => {
  try {
    // Validate Environment Variables before proceeding
    validateEnv();

    // Connect to MongoDB
    await connectDatabase();

    // Run pending DB migrations before serving traffic. Fail-closed in
    // production (a half-migrated schema must never serve); warn-and-
    // continue elsewhere. Set MIGRATE_ON_BOOT=false to skip explicitly.
    if (process.env.MIGRATE_ON_BOOT !== 'false') {
      try {
        const { runMigrations } = await import('./migrations/runner.js');
        const result = await runMigrations('up');
        if ('applied' in result && result.applied.length > 0) {
          console.log(`✅ Applied ${result.applied.length} DB migration(s): ${result.applied.join(', ')}`);
        }
      } catch (migrationError) {
        console.error('❌ DB migrations failed:', (migrationError as Error).message);
        if (config.nodeEnv === 'production') {
          process.exit(1);
        }
      }
    }
    
    // Connect to Redis (optional)
    try {
      await connectRedis();
    } catch (redisError) {
      console.warn('⚠️ Redis connection failed, continuing without cache:', (redisError as Error).message);
    }

    // --- Middleware Setup ---
    
    // Request ID Generation
    app.use(requestIdMiddleware);

    // Cookies (httpOnly session cookies) + double-submit CSRF protection
    app.use(cookieParser());
    app.use(csrfProtection);

    // Error monitoring (no-op unless SENTRY_DSN is set) + HTTP metrics
    app.use(sentryMiddleware);
    app.use(httpMetrics);

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

    // Legacy no-op CSRF placeholder — real protection is double-submit
    // tokens via csrfProtection (src/middleware/cookies.ts), mounted below.

    // CORS — single shared policy (REST and GraphQL alike). Production
    // allows the configured frontend plus ALLOWED_ORIGINS entries.
    const corsOptions = {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin) return callback(null, true);
        if (config.nodeEnv === 'development') return callback(null, true);
        const allowedOrigins = [
          config.frontendUrl,
          ...(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
        ];
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-API-Secret', 'X-CSRF-Token', 'X-Bot-Key'],
    };
    // Public, credential-free endpoints are embedded on tenants' own websites
    // (signup forms, chatbot widget, delivery API) and must accept any origin.
    // They never read the dashboard session cookie.
    const PUBLIC_CORS_PREFIXES = ['/api/v1/public/', '/api/v1/bots/', '/api/v1/deliver/'];
    const publicCors = cors({ origin: true, credentials: false, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Bot-Key'] });
    const dashboardCors = cors(corsOptions);
    app.use((req, res, next) => {
      const isPublic = PUBLIC_CORS_PREFIXES.some((p) => req.path.startsWith(p));
      return (isPublic ? publicCors : dashboardCors)(req, res, next);
    });

    // Body Parser — Stripe webhook needs the RAW body for signature
    // verification, so it is exempted here and parsed via express.raw()
    // in billingRoutes instead (a consumed stream cannot be re-read).
    const stripeWebhookPath = '/api/v1/billing/webhook';
    app.use((req, res, next) => {
      if (req.originalUrl === stripeWebhookPath) return next();
      express.json({ limit: '10mb' })(req, res, next);
    });
    app.use((req, res, next) => {
      if (req.originalUrl === stripeWebhookPath) return next();
      express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
    });

    // Embed scripts (chat widget, signup form) with this deployment's URLs baked in
    app.get(['/widget.js', '/subscribe.js'], serveEmbedScript);

    // Static Files
    app.use(express.static('public'));
    app.use('/uploads', express.static('uploads'));

    // Logging
    if (config.nodeEnv === 'development') app.use(morgan('dev'));
    else app.use(morgan('combined'));

    // Rate Limiting — applies in every env (dev uses generous config
    // values, not a bypass). No path exemptions: delivery has its own
    // per-key limiters, dashboard routes need the global one.
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
        // Liveness probes must never 429 (orchestrators kill the pod)
        if (['/live', '/health', '/ready', '/metrics'].includes(req.path)) return true;
        // Stripe webhooks: signature-verified, retried by Stripe on 429
        if (req.path === '/api/v1/billing/webhook') return true;
        return false;
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
      cors(corsOptions),
      express.json(),
      expressMiddleware(server, {
        context: async ({ req }) => {
          const token = req.headers.authorization || '';
          if (!token.startsWith('Bearer ')) {
            return {};
          }
          try {
            const decoded = jwt.verify(token.split(' ')[1], config.jwt.secret) as any;
            // Enforce access-token type like REST (refresh tokens rejected)
            if (decoded.type && decoded.type !== 'access') {
              return {};
            }
            return {
              user: { id: decoded.userId, role: decoded.role },
              tenantId: decoded.tenantId,
              mfaVerified: decoded.mfaVerified,
            };
          } catch (e) {
            return {};
          }
        },
      }),
    );

    // --- REST API API Routes ---
    // AI context lets every AI call resolve the caller's tenant (BYOK + metering)
    app.use('/api/v1', aiContextMiddleware);
    app.use('/api/v1', routes);

    // --- API Documentation ---
    app.use('/api-docs', swaggerRouter);

    // Root-level liveness probes for Docker/Kubernetes container health checks
    app.get(['/live', '/health', '/ready'], (_req, res) => {
      res.status(200).json({ status: 'ok', success: true, timestamp: new Date().toISOString() });
    });

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
    // Sentry first (captures with request context), then 404 + custom handler
    app.use(sentryErrorMiddleware);
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
    webhookRetryWorker.start();
    emailCampaignWorker.start();

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
