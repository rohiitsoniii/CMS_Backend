import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 30000,
    setupFiles: ['src/test/setup.ts'],
    globalTeardown: ['src/test/globalTeardown.ts'],
    pool: 'forks',
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 30,
        functions: 35,
        branches: 18,
        statements: 30,
      },
    },
  },
});
