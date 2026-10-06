import rateLimit from 'express-rate-limit';

export const authBruteForceLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login/auth requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts',
    message: 'Your account/IP has been temporarily locked due to numerous failed attempts. Please try again after 15 minutes.'
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
