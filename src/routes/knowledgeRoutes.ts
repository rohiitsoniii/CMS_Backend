import { Router } from 'express';
import {
  getKnowledgeList,
  getKnowledge,
  createKnowledge,
  updateKnowledge,
  deleteKnowledge,
  importKnowledge,
  getKnowledgeStats,
  testChatbot,
} from '../controllers/knowledgeController.js';
import { authenticateJWT, requirePermission } from '../middleware/index.js';

const router = Router({ mergeParams: true });

// All routes require authentication
router.use(authenticateJWT);

// Get knowledge base stats
router.get('/stats', getKnowledgeStats);

// Test chatbot with a query
router.post('/test', testChatbot);

// Bulk import
router.post('/import', requirePermission('content:write'), importKnowledge);

// List knowledge entries
router.get('/', getKnowledgeList);

// Create knowledge entry
router.post('/', requirePermission('content:write'), createKnowledge);

// Get single entry
router.get('/:id', getKnowledge);

// Update entry
router.put('/:id', requirePermission('content:write'), updateKnowledge);

// Delete entry
router.delete('/:id', requirePermission('content:delete'), deleteKnowledge);

export default router;
