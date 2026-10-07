import { Router } from 'express';
import { body } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { authenticateJWT } from '../middleware/index.js';
import { passwordResetBruteForceLimit } from '../middleware/bruteForce.js';
import { exportData, eraseAccount } from '../controllers/gdprController.js';

const router = Router();

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

router.use(authenticateJWT);

router.get('/export', exportData);
router.post(
  '/erase',
  passwordResetBruteForceLimit,
  [body('password').notEmpty().withMessage('Password confirmation is required')],
  validate,
  eraseAccount
);

export default router;
