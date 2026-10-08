import rateLimit from 'express-rate-limit';

/**
 * Login / register / password reset / 2FA. Only FAILED attempts count, and
 * the bucket is per IP + email, so a whole office behind one NAT address is
 * not locked out by each other's normal sign-ins.
 */
export const authBruteForceLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 failed attempts per IP+account per window
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${req.ip}|${email}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts',
    message: 'Your account/IP has been temporarily locked due to numerous failed attempts. Please try again after 15 minutes.'
  }
});

/**
 * Session refresh. Needs a valid httpOnly refresh cookie, so it is not a
 * password-guessing target; the limit only stops runaway clients.
 */
export const refreshRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many session refreshes',
    message: 'Please wait a moment and try again.'
  }
});

export const passwordResetBruteForceLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 password reset requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many password reset attempts',
    message: 'Please wait an hour before requesting another password reset.'
  }
});
