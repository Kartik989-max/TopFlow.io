import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    environment: 'node',
    globals: true,
    testTimeout: 30000,
    hookTimeout: 60000,
    mockReset: true,
  },
});
