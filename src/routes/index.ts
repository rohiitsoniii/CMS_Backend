import { Router } from 'express';
import authRoutes from './authRoutes.js';
import projectRoutes from './projectRoutes.js';
import contentRoutes from './contentRoutes.js';
import knowledgeRoutes from './knowledgeRoutes.js';
import mediaRoutes from './mediaRoutes.js';
import analyticsRoutes from './analyticsRoutes.js';
import deliveryRoutes from './deliveryRoutes.js';
import contentTypeRoutes from './contentTypeRoutes.js';
import componentRoutes from './componentRoutes.js';
import localeRoutes from './localeRoutes.js';
import versionRoutes from './versionRoutes.js';
import workflowRoutes, { contentWorkflowRouter } from './workflowRoutes.js';
import scheduleRoutes, { contentScheduleRouter } from './scheduleRoutes.js';
import schedulingRoutes from './schedulingRoutes.js';
import roleRoutes from './roleRoutes.js';
import teamRoutes from './teamRoutes.js';
import endUserRoutes from './endUserRoutes.js';
import webhookRoutes from './webhookRoutes.js';
import auditRoutes from './auditRoutes.js';
import backupRoutes from './backupRoutes.js';
import trashRoutes from './trashRoutes.js';
import duplicationRoutes from './duplicationRoutes.js';
import bulkOperationsRoutes from './bulkOperationsRoutes.js';
import commentsRoutes from './commentsRoutes.js';
import validationRoutes from './validationRoutes.js';
import archiveRoutes from './archiveRoutes.js';
import fieldPermissionsRoutes from './fieldPermissionsRoutes.js';
import billingRoutes from './billingRoutes.js';
import supportRoutes from './supportRoutes.js';
import onboardingRoutes from './onboardingRoutes.js';
import helpCenterRoutes from './helpCenterRoutes.js';
import previewRoutes from './previewRoutes.js';
import envVariableRoutes from './envVariableRoutes.js';
import twoFactorRoutes from './twoFactorRoutes.js';
import ssoRoutes from './ssoRoutes.js';
import domainRoutes from './domainRoutes.js';
import templateRoutes from './templateRoutes.js';
import deploymentRoutes from './deploymentRoutes.js';
import systemRoutes from './systemRoutes.js';
import nlqRoutes from './nlqRoutes.js';
import docsRoutes from './docsRoutes.js';
import scimRoutes, { scimAdminRouter } from './scimRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import gdprRoutes from './gdprRoutes.js';
import ragBotRoutes from './ragBotRoutes.js';
import ragPublicRoutes from './ragPublicRoutes.js';
import seoRoutes from './seoRoutes.js';
import { getJob } from '../controllers/jobStatusController.js';



import healthRoutes from './healthRoutes.js';

import { serveMediaFile } from '../controllers/mediaController.js';
import { exportContent, importContent, validateImport } from '../controllers/importExportController.js';
import { authenticateJWT, requirePermission } from '../middleware/index.js';

const router = Router();

// Global Health and Readiness Probes
router.use('/', healthRoutes);

// ============================
// Auth Routes
// ============================
router.use('/auth', authRoutes);

// ============================
// Admin Routes (Protected)
// ============================

// Schema Management (Phase 1)
router.use('/content-types', contentTypeRoutes);
router.use('/components', componentRoutes);

// Localization (Phase 2)
router.use('/locales', localeRoutes);

// Workflows (Phase 3)
router.use('/workflows', workflowRoutes);

// Schedules (Phase 3)
router.use('/schedules', scheduleRoutes);

// Webhooks (New)
router.use('/webhooks', webhookRoutes);

// Projects
router.use('/projects', projectRoutes);

// Content (mounted under projects and globally)
router.use('/projects/:projectId/content', contentRoutes);
router.use('/projects/:projectId/content', schedulingRoutes);
router.use('/content', contentRoutes);

// Cross-project content activity (Phase 6)
router.get('/projects/all/content/recent', authenticateJWT, (req, res, next) => {
  import('../controllers/contentController.js').then(ctrl => (ctrl.getRecentContent as any)(req, res, next)).catch(next);
});


// Content-specific routes (Phase 2 & 3)
// These are mounted globally for easier access
router.use('/content/:id/versions', versionRoutes);
// Alias for frontend legacy path /projects/:projectId/content/:id/versions
router.use('/projects/:projectId/content/:id/versions', versionRoutes);
router.use('/content/:id/workflow', contentWorkflowRouter);
router.use('/content/:id/schedules', contentScheduleRouter);

// Knowledge base (mounted under projects)
router.use('/projects/:projectId/knowledge', knowledgeRoutes);

// RAG Bots (mounted under projects)
router.use('/projects/:projectId/rag-bots', ragBotRoutes);

// SEO (mounted under projects)
router.use('/projects', seoRoutes);

// Media (global for tenant)
router.use('/admin/media', mediaRoutes);

// Analytics (global for tenant)
// Analytics (global for tenant)
router.use('/admin/analytics', analyticsRoutes);

// ============================
// RBAC & Users (Phase 4)
// ============================
router.use('/roles', roleRoutes);
router.use('/team', teamRoutes);
router.use('/users', endUserRoutes);

// Audit Logs
router.use('/audit-logs', auditRoutes);

// Backups (single mount at root; router defines /backups + /projects/:projectId/backups)
router.use('/', backupRoutes);

// Trash/Recycle Bin (single mount at root; router defines /projects/:projectId/trash + /trash/...)
router.use('/', trashRoutes);

// Content Duplication
router.use('/duplication', duplicationRoutes);

// Bulk Operations
router.use('/bulk-operations', bulkOperationsRoutes);

// Comments & Collaboration
router.use('/comments', commentsRoutes);

// Validation Rules
router.use('/validation', validationRoutes);

// Archive (single mount at root; router defines /archive/... + /projects/:projectId/archive)
router.use('/', archiveRoutes);

// Field-Level Permissions
router.use('/permissions', fieldPermissionsRoutes);

// Billing & Subscriptions
router.use('/billing', billingRoutes);

// Support Tickets
router.use('/support', supportRoutes);

// Onboarding
router.use('/onboarding', onboardingRoutes);

// Help Center
router.use('/help', helpCenterRoutes);

// Notifications
router.use('/notifications', notificationRoutes);

// GDPR data-subject rights (export + erasure)
router.use('/gdpr', gdprRoutes);

// Preview Tokens
router.use('/projects/:projectId', previewRoutes);

// Environment Variables
router.use('/env-variables', envVariableRoutes);

// Two-Factor Authentication
router.use('/two-factor', twoFactorRoutes);

// SSO (Google OAuth)
router.use('/sso', ssoRoutes);

// Custom Domains
router.use('/domains', domainRoutes);

// Project Templates
router.use('/templates', templateRoutes);



// CI/CD Deployments
router.use('/deployments', deploymentRoutes);

// ============================
// Background Job Status (for async operations)
// ============================
router.get('/jobs/:jobId', authenticateJWT, getJob);

// ============================
// System/SuperAdmin (Phase 6)
// ============================
router.use('/system', systemRoutes);

// NLQ
router.use('/nlq', nlqRoutes);

// OpenAPI Docs
router.use('/docs', docsRoutes);

// SCIM Provisioning
router.use('/scim/v2', scimRoutes);
// SCIM token management (JWT + users:manage guarded; logic lives in scimRoutes.ts)
router.use('/admin/scim', scimAdminRouter);




// Import/Export
router.get('/projects/:projectId/export', authenticateJWT, requirePermission('content:read'), exportContent);
router.post('/projects/:projectId/import', authenticateJWT, requirePermission('content:write'), importContent);
router.post('/projects/:projectId/import/validate', authenticateJWT, requirePermission('content:write'), validateImport);

// ============================
// Public Delivery API
// ============================
router.use('/deliver', deliveryRoutes);

// ============================
// Public RAG Bot Widget API
// ============================
router.use('/bots', ragPublicRoutes);

// ============================
// Public Media Serving
// ============================
router.get('/media/:id', serveMediaFile);

export default router;
