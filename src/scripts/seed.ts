import { Tenant, User, Content, APIKey, Project } from '../models/index.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';

const seedData = async () => {
  try {
    console.log('🌱 Starting database seed...\n');
    
    await connectDatabase();
    
    // Clear existing data
    await Promise.all([
      Tenant.deleteMany({}),
      User.deleteMany({}),
      Project.deleteMany({}),
      Content.deleteMany({}),
      APIKey.deleteMany({}),
    ]);
    console.log('✅ Cleared existing data');
    
    // Create demo tenant
    const tenant = await Tenant.create({
      name: 'Demo Company',
      slug: 'demo-company',
      email: 'demo@example.com',
      password: 'Demo@123',
      company: 'Demo Company Inc.',
      subscription: {
        plan: 'pro',
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
    console.log('✅ Created demo tenant');
    
    // Create demo user
    const user = await User.create({
      tenantId: tenant._id,
      email: 'demo@example.com',
      password: 'Demo@123',
      firstName: 'John',
      lastName: 'Doe',
      role: 'owner',
      isEmailVerified: true,
    });
    console.log('✅ Created demo user');
    
    // Create demo project
    const project = await Project.create({
      tenantId: tenant._id,
      name: 'Demo Website',
      slug: 'demo-website',
      description: 'Demo Website for Headless CMS testing',
      status: 'active',
      settings: {
        defaultLocale: 'en',
        locales: ['en', 'es', 'fr'],
        timezone: 'UTC',
      },
      branding: {
        colors: {
          primary: '#6366f1',
          secondary: '#8b5cf6',
        },
      },
      stats: {
        contentCount: 5,
        blogCount: 1,
        apiCalls: 0,
      },
      createdBy: user._id,
    });
    console.log('✅ Created demo project');

    // Create API key
    const keyPair = APIKey.generateKeyPair();
    const apiKey = await APIKey.create({
      tenantId: tenant._id,
      name: 'Development API Key',
      description: 'API key for local development',
      apiKey: keyPair.apiKey,
      apiKeyHash: keyPair.apiKeyHash,
      secretKey: keyPair.secretKey,
      secretKeyHash: keyPair.secretKeyHash,
      permissions: ['content:read', 'content:write'],
      allowedOrigins: ['*'],
      createdBy: user._id,
    });
    console.log('✅ Created demo API key');
    
    // Create sample content
    const sampleContent = [
      {
        tenantId: tenant._id,
        projectId: project._id,
        type: 'hero',
        name: 'Homepage Hero',
        slug: 'homepage-hero',
        data: {
          title: 'Build Amazing Websites with Our CMS',
          subtitle: 'The easiest way to manage your content',
          background_image: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1920',
          cta_primary: { text: 'Get Started', link: '/signup' },
          cta_secondary: { text: 'Learn More', link: '/features' },
        },
        status: 'published',
        publishedAt: new Date(),
        createdBy: user._id,
        updatedBy: user._id,
      },
      {
        tenantId: tenant._id,
        projectId: project._id,
        type: 'navigation',
        name: 'Main Navigation',
        slug: 'main-navigation',
        data: {
          logo: 'https://via.placeholder.com/150x50',
          items: [
            { label: 'Home', link: '/' },
            { label: 'Features', link: '/features' },
            { label: 'Pricing', link: '/pricing' },
            { label: 'Blog', link: '/blog' },
            { label: 'Contact', link: '/contact' },
          ],
        },
        status: 'published',
        publishedAt: new Date(),
        createdBy: user._id,
        updatedBy: user._id,
      },
      {
        tenantId: tenant._id,
        projectId: project._id,
        type: 'blog',
        name: 'Getting Started with Headless CMS',
        slug: 'getting-started-with-headless-cms',
        data: {
          title: 'Getting Started with Headless CMS',
          excerpt: 'Learn how to set up and use our headless CMS to manage your website content.',
          content: '<h2>Introduction</h2><p>Welcome to our headless CMS! This guide will help you get started...</p><h2>Step 1: Create Your Account</h2><p>First, sign up for an account...</p>',
          featured_image: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800',
          author: 'John Doe',
        },
        tags: ['tutorial', 'getting-started', 'cms'],
        category: 'Tutorials',
        status: 'published',
        publishedAt: new Date(),
        createdBy: user._id,
        updatedBy: user._id,
      },
      {
        tenantId: tenant._id,
        projectId: project._id,
        type: 'faq',
        name: 'General FAQs',
        slug: 'general-faqs',
        data: {
          items: [
            {
              question: 'What is a headless CMS?',
              answer: 'A headless CMS is a content management system that provides content via API, allowing you to use any frontend technology.',
            },
            {
              question: 'How do I get my API key?',
              answer: 'You can generate API keys from your dashboard under Settings > API Keys.',
            },
            {
              question: 'Is there a free plan?',
              answer: 'Yes! We offer a generous free tier that includes 10 blog posts, 5 hero sections, and 1,000 API calls per month.',
            },
          ],
        },
        status: 'published',
        publishedAt: new Date(),
        createdBy: user._id,
        updatedBy: user._id,
      },
      {
        tenantId: tenant._id,
        projectId: project._id,
        type: 'footer',
        name: 'Main Footer',
        slug: 'main-footer',
        data: {
          copyright: '© 2025 Demo Company. All rights reserved.',
          links: [
            { label: 'Privacy Policy', link: '/privacy' },
            { label: 'Terms of Service', link: '/terms' },
            { label: 'Contact', link: '/contact' },
          ],
          social: [
            { platform: 'twitter', link: 'https://twitter.com' },
            { platform: 'linkedin', link: 'https://linkedin.com' },
            { platform: 'github', link: 'https://github.com' },
          ],
        },
        status: 'published',
        publishedAt: new Date(),
        createdBy: user._id,
        updatedBy: user._id,
      },
    ];
    
    await Content.insertMany(sampleContent);
    console.log('✅ Created sample content\n');
    
    // Print credentials
    console.log('═'.repeat(60));
    console.log('\n🎉 Seed completed successfully!\n');
    console.log('📧 Demo Login Credentials:');
    console.log('   Email: demo@example.com');
    console.log('   Password: Demo@123\n');
    console.log('🔑 Demo API Key:');
    console.log(`   API Key: ${keyPair.apiKey}`);
    console.log(`   Secret Key: ${keyPair.secretKey}`);
    console.log('\n⚠️  Save the secret key - it will not be shown again!\n');
    console.log('═'.repeat(60));
    
    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
};

seedData();
