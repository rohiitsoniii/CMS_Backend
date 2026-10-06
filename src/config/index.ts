import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Validate required environment variables at startup
const requiredEnvVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'API_KEY_SECRET'];
const missing = requiredEnvVars.filter((key) => !process.env[key]);

if (missing.length > 0) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `\n❌ FATAL: Missing required environment variables:\n  ${missing.join('\n  ')}\n` +
      `Set these in your .env file before starting the server.\n`
    );
  } else {
    console.warn(
      `\n⚠️  WARNING: Missing environment variables: ${missing.join(', ')}\n` +
      `   Using insecure development defaults. DO NOT use in production!\n`
    );
  }
}

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  
  // MongoDB
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/headless_cms',
  
  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  
  // JWT — no insecure fallbacks
  jwt: {
    secret: process.env.JWT_SECRET || 'DEV_ONLY_SECRET_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'DEV_ONLY_REFRESH_SECRET_change_me',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  
  // API Key
  apiKeySecret: process.env.API_KEY_SECRET || 'DEV_ONLY_API_KEY_SECRET_change_me',
  
  // AWS S3
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1',
    s3Bucket: process.env.AWS_S3_BUCKET || 'headless-cms-media',
  },
  
  // CloudFront
  cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN,
  
  // Frontend URL
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  
  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
};

// Subscription Plans Configuration
export const subscriptionPlans = {
  free: {
    name: 'Free',
    price: 0,
    limits: {
      blogPosts: 10,
      heroSections: 5,
      navigationMenus: 3,
      footerSections: 2,
      customBlocks: 5,
      apiCallsPerMonth: 1000,
      storageBytes: 100 * 1024 * 1024, // 100MB
      webhooks: false,
      customDomains: false,
      teamMembers: 1,
    },
  },
  basic: {
    name: 'Basic',
    price: 29,
    limits: {
      blogPosts: 100,
      heroSections: 20,
      navigationMenus: 10,
      footerSections: 10,
      customBlocks: 50,
      apiCallsPerMonth: 50000,
      storageBytes: 5 * 1024 * 1024 * 1024, // 5GB
      webhooks: false,
      customDomains: false,
      teamMembers: 5,
    },
  },
  pro: {
    name: 'Pro',
    price: 99,
    limits: {
      blogPosts: -1, // Unlimited
      heroSections: -1,
      navigationMenus: -1,
      footerSections: -1,
      customBlocks: -1,
      apiCallsPerMonth: -1,
      storageBytes: 50 * 1024 * 1024 * 1024, // 50GB
      webhooks: true,
      customDomains: true,
      teamMembers: 20,
    },
  },
  enterprise: {
    name: 'Enterprise',
    price: -1, // Custom pricing
    limits: {
      blogPosts: -1,
      heroSections: -1,
      navigationMenus: -1,
      footerSections: -1,
      customBlocks: -1,
      apiCallsPerMonth: -1,
      storageBytes: -1,
      webhooks: true,
      customDomains: true,
      teamMembers: -1,
    },
  },
};

export type SubscriptionPlan = keyof typeof subscriptionPlans;
