import express from 'express';
import * as ragBotController from '../controllers/ragBotController.js';
import * as ragIngestionController from '../controllers/ragIngestionController.js';
import { protect } from '../middleware/authMiddleware.js';
import multer from 'multer';

const router = express.Router({ mergeParams: true });

// Configure multer for temporary ingestion uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, 'uploads/temp');
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Create temp directory if it doesn't exist
import fs from 'fs';
if (!fs.existsSync('uploads/temp')) {
  fs.mkdirSync('uploads/temp', { recursive: true });
}

// All routes here are protected and require a project context (covered by index mounting)
router.use(protect);

// Bot CRUD
router.get('/', ragBotController.listBots);
router.post('/', ragBotController.createBot);
router.get('/:botId', ragBotController.getBot);
router.put('/:botId', ragBotController.updateBot);
router.delete('/:botId', ragBotController.deleteBot);

// Ingestion
router.post('/:botId/ingest/document', upload.single('file'), ragIngestionController.uploadDocument);
router.post('/:botId/ingest/url', ragIngestionController.crawlUrl);
router.post('/:botId/ingest/cms', ragIngestionController.syncCmsContent);
router.get('/:botId/sources', ragIngestionController.listSources);
router.delete('/:botId/sources', ragIngestionController.deleteSource);

// Token & Analytics
router.post('/:botId/api-key', ragBotController.regenerateApiKey);
router.get('/:botId/analytics', ragBotController.getBotAnalytics);
router.get('/:botId/unanswered', ragBotController.getUnansweredQuestions);
router.get('/:botId/embed-code', ragBotController.getEmbedCode);

export default router;
