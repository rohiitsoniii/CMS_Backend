import { authenticateJWT, requireRole } from './auth.js';

export const protect = authenticateJWT;
export const authorize = requireRole;

export default {
  protect,
  authorize,
};
