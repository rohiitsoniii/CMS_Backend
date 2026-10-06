/**
 * Search Routes
 * 
 * Routes for search functionality
 */

import express from 'express';
import * as searchController from '../controllers/searchController';
import { authenticate } from '../middleware/auth';

const router = express.Router({ mergeParams: true });

// All search routes require authentication
router.use(authenticate);

// Search
router.get('/search', searchController.searchContent);

// Autocomplete
router.get('/search/autocomplete', searchController.autocomplete);

// Reindex
router.post('/search/reindex', searchController.reindex);

// Status
router.get('/search/status', searchController.getSearchStatus);

export default router;
