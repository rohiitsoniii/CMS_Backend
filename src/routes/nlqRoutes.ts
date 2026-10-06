import express from 'express';
import * as nlqController from '../controllers/nlqController.js';
import { authenticateJWT } from '../middleware/index.js';

const router = express.Router();

router.use(authenticateJWT);

router.post('/query', nlqController.queryDatabase);

export default router;
