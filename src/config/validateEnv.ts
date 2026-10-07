const PLACEHOLDER_PATTERNS = [
  'your_',
  'your-',
  'change_this',
  'change-this',
  'change_me',
  'change-me',
  'example',
  'test_',
  'placeholder',
  'DEV_ONLY',
];

const isPlaceholder = (value: string): boolean => {
  const lower = value.toLowerCase();
  return PLACEHOLDER_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
};

export const validateEnv = () => {
  const missingVars: string[] = [];

  const requiredVars = [
    'NODE_ENV',
    'PORT',
    'MONGODB_URI',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'FRONTEND_URL',
    'API_KEY_SECRET',
  ];

  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    console.error('❌ Missing Required Environment Variables:');
    missingVars.forEach(v => console.error(`   - ${v}`));
    console.error('Please configure them in your .env file before starting the application.');
    process.exit(1);
  }

  // Secret strength checks — fatal in production, warnings in dev/test
  const secrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'API_KEY_SECRET'];
  const fatal: string[] = [];

  for (const name of secrets) {
    const value = process.env[name] || '';
    if (value.length < 32) {
      fatal.push(`${name} must be at least 32 characters (got ${value.length})`);
    } else if (isPlaceholder(value)) {
      fatal.push(`${name} looks like a placeholder/default value`);
    }
  }

  if (fatal.length > 0) {
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ Refusing to start with weak secrets:');
      fatal.forEach(f => console.error(`   - ${f}`));
      process.exit(1);
    }
    fatal.forEach(f => console.warn(`⚠️ WARNING: ${f}. Fix before deploying to production.`));
  }
};
