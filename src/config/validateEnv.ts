export const validateEnv = () => {
  const missingVars: string[] = [];

  const requiredVars = [
    'NODE_ENV',
    'PORT',
    'MONGODB_URI',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'FRONTEND_URL'
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

  // Validate specific formats if needed
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.warn('⚠️ WARNING: JWT_SECRET should be at least 32 characters long for security.');
  }
};
