import mongoose from 'mongoose';
import { config } from './index.js';

let memoryServerInstance: any = null;

const autoSeedIfEmpty = async () => {
  try {
    const { Tenant, User, Project, Content, Workflow } = await import('../models/index.js');
    const userCount = await User.countDocuments();
    if (userCount > 0) return;

    console.log('🌱 Database is empty. Seeding initial demo data...');

    const tenant = await Tenant.create({
      name: 'Demo Company',
      slug: 'demo-company',
      email: 'demo@example.com',
      password: 'Demo@123',
      company: 'Demo Company Inc.',
      subscription: {
        plan: 'enterprise',
        startDate: new Date(),
        isActive: true,
        billingCycle: 'monthly',
      },
      settings: {
        timezone: 'UTC',
        defaultLanguage: 'en',
        allowedOrigins: ['http://localhost:3000', 'http://localhost:5173'],
      },
    });

    const user = await User.create({
      tenantId: tenant._id,
      email: 'demo@example.com',
      password: 'Demo@123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'owner',
      isEmailVerified: true,
    });

    const project = await Project.create({
      tenantId: tenant._id,
      name: 'Demo Website',
      slug: 'demo-website',
      description: 'Demo project for testing and content management',
      status: 'active',
      settings: {
        defaultLocale: 'en',
        locales: ['en', 'es', 'fr'],
        timezone: 'UTC',
      },
      createdBy: user._id,
    });

    await Workflow.create({
      tenantId: tenant._id,
      projectId: project._id,
      name: 'Editorial Review',
      apiId: 'editorial-review',
      description: 'Standard 3-stage editorial approval workflow',
      steps: [
        { id: 'step_draft', name: 'Draft', order: 0, requiresApproval: false, autoAdvance: false },
        { id: 'step_review', name: 'Editorial Review', order: 1, requiresApproval: true, autoAdvance: false },
        { id: 'step_publish', name: 'Ready to Publish', order: 2, requiresApproval: true, autoAdvance: false }
      ],
      isActive: true,
      createdBy: user._id,
      updatedBy: user._id
    });

    await Content.create({
      tenantId: tenant._id,
      projectId: project._id,
      type: 'page',
      name: 'Welcome Page',
      slug: 'welcome-page',
      data: {
        title: 'Welcome to Headless CMS',
        body: 'This is sample content ready for testing workflows and editing.',
      },
      status: 'draft',
      createdBy: user._id,
      updatedBy: user._id,
    });

    console.log('✅ Demo data seeded successfully: demo@example.com / Demo@123');
  } catch (seedErr) {
    console.warn('⚠️ Auto-seed warning:', (seedErr as Error).message);
  }
};

export const connectDatabase = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(config.mongodbUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 2000,
      socketTimeoutMS: 45000,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    await autoSeedIfEmpty();
  } catch (error) {
    console.warn(`⚠️ Unable to reach MongoDB at ${config.mongodbUri}. Starting embedded MongoMemoryServer...`);
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServerInstance = await MongoMemoryServer.create();
      const memUri = memoryServerInstance.getUri();
      const conn = await mongoose.connect(memUri);
      console.log(`✅ Embedded MongoMemoryServer connected at: ${conn.connection.host}`);
      await autoSeedIfEmpty();
    } catch (memError) {
      console.error('❌ Error connecting to MongoMemoryServer:', memError);
      process.exit(1);
    }
  }

  mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err);
  });
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    if (memoryServerInstance) {
      await memoryServerInstance.stop();
    }
    console.log('MongoDB disconnected');
  } catch (error) {
    console.error('Error disconnecting from MongoDB:', error);
  }
};
