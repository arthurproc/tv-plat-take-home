import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // DB-backed integration tests need a little more headroom than the default.
    testTimeout: 20000,
    hookTimeout: 30000,
    // Run test files serially — they share one Postgres database.
    fileParallelism: false,
  },
});
