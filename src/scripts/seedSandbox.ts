import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Tenant, User, Project, ContentType, Content } from '../models/index.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/headless-cms';

async function seedSandbox() {
    console.log("Connecting to database:", DB_URI);
    await mongoose.connect(DB_URI);
    console.log("Connected to MongoDB.");

    // Clean existing sandbox
    const sandboxSlug = 'sandbox-demo';
    const existingTenant = await Tenant.findOne({ slug: sandboxSlug });
    if (existingTenant) {
        console.log(`Cleaning old sandbox tenant ${existingTenant._id}...`);
        await Project.deleteMany({ tenantId: existingTenant._id });
        await ContentType.deleteMany({ tenantId: existingTenant._id });
        await Content.deleteMany({ tenantId: existingTenant._id });
        await Tenant.deleteOne({ _id: existingTenant._id });
    }

    // Create Tenant
    const tenant = await Tenant.create({
        name: 'Sandbox Demo',
        slug: sandboxSlug,
        subscription: { plan: 'enterprise', status: 'active' },
        createdAt: new Date(),
        updatedAt: new Date()
    });

    console.log(`Created Sandbox Tenant: ${tenant._id}`);

    // Create Project
    const project = await Project.create({
        tenantId: tenant._id,
        name: 'Demo Blog',
        slug: 'demo-blog',
        description: 'A sandbox project containing a sample blog',
        environments: [{
            name: 'production',
            description: 'Production Environment',
            color: '#10b981',
            isDefault: true
        }],
        locales: [{ code: 'en', name: 'English', isDefault: true }],
        status: 'active'
    });

    console.log(`Created Sandbox Project: ${project._id}`);

    // Create ContentType (Article)
    const articleType = await ContentType.create({
        tenantId: tenant._id,
        projectId: project._id,
        name: 'Article',
        slug: 'article',
        description: 'Standard blog post',
        type: 'collection',
        fields: [
            { name: 'title', type: 'string', required: true },
            { name: 'body', type: 'richtext', required: true },
            { name: 'publishedDate', type: 'date', required: false }
        ],
        status: 'published'
    });

    console.log(`Created ContentType: ${articleType._id}`);

    // Populate Content
    for(let i=1; i<=5; i++) {
        await Content.create({
            tenantId: tenant._id,
            projectId: project._id,
            contentTypeId: articleType._id,
            type: 'article',
            name: `Sample Article ${i}`,
            slug: `sample-article-${i}`,
            data: {
                title: `How to build headless architectures part ${i}`,
                body: `<p>This is the amazing content for article ${i}...</p>`,
                publishedDate: new Date().toISOString()
            },
            status: 'published'
        });
    }

    console.log("Populated 5 dummy articles.");
    
    console.log("Sandbox Seeding Complete!");
    process.exit(0);
}

seedSandbox().catch(console.error);
