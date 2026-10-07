import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';

/**
 * Shared express-validator result checker — unified 400 envelope.
 */
export const validate = (req: Request, res: Response, next: NextFunction): void => {
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

/** MongoDB ObjectId route param. */
export const mongoId = (name = 'id') =>
  param(name).isMongoId().withMessage(`Invalid ${name}`);

/** URL-safe slug route param (projects, content slugs). */
export const slugParam = (name: string) =>
  param(name)
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 200 })
    .matches(/^[a-z0-9-]+$/)
    .withMessage(`Invalid ${name}`);

/** Standard ?page=&limit= pagination (limit capped at 100). */
export const paginationQuery = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

/** Bounded free-text search (?search=). */
export const searchQuery = query('search')
  .optional()
  .isString()
  .isLength({ max: 200 })
  .withMessage('Search must be at most 200 characters');

export { body, param, query };
