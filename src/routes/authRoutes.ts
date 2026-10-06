import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import * as authController from '../controllers/authController.js';
import { authenticateJWT, requirePermission } from '../middleware/index.js';
import { authBruteForceLimit } from '../middleware/bruteForce.js';

// Shared validation result checker
const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array().map((e) => ({ field: (e as any).path, message: e.msg })),
    });
    return;
  }
  next();
};

const router = Router();

// Validation middleware
const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  body('company').optional().trim(),
  body('website').optional().trim().isURL().withMessage('Invalid website URL'),
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

const apiKeyValidation = [
  body('name').trim().notEmpty().withMessage('API key name is required'),
  body('description').optional().trim(),
  body('permissions').optional().isArray(),
  body('allowedOrigins').optional().isArray(),
  body('expiresAt').optional().isISO8601().withMessage('Invalid expiration date'),
];

// Public routes
router.post('/register', authBruteForceLimit, registerValidation, validate, authController.register);
router.post('/login', authBruteForceLimit, loginValidation, validate, authController.login);
router.post('/refresh', authController.refresh);

// Protected routes
router.get('/me', authenticateJWT, authController.getProfile);
router.put('/profile', authenticateJWT, authController.updateProfile);
router.put('/password', authenticateJWT, authController.changePassword);

// API Key management
router.post(
  '/api-keys',
  authenticateJWT,
  requirePermission('api-keys:manage'),
  apiKeyValidation,
  validate,
  authController.createAPIKey
);
router.get(
  '/api-keys',
  authenticateJWT,
  requirePermission('api-keys:read'),
  authController.getAPIKeys
);
router.delete(
  '/api-keys/:id',
  authenticateJWT,
  requirePermission('api-keys:manage'),
  authController.deleteAPIKey
);

export default router;
