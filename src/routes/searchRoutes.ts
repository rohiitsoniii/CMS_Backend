/**
 * Search Routes
 * 
 * Routes for search functionality
 */

import express from 'express';
import * as searchController from '../controllers/searchController';
import { authenticate } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/projectAccess.js';

const router = express.Router({ mergeParams: true });

// All search routes require authentication
router.use(authenticate);
router.use(requireProjectAccess);

// Search
router.get('/', searchController.searchContent);

// Autocomplete
router.get('/autocomplete', searchController.autocomplete);

// Reindex
router.post('/reindex', searchController.reindex);

// Status
router.get('/status', searchController.getSearchStatus);

export default router;
