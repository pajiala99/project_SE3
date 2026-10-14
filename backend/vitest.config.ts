import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests run against a real PostgreSQL database (foodbridge_test) and the
    // real Python matching service on :8000 — see scripts/test-all.sh.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://foodbridge:foodbridge@localhost:5432/foodbridge_test',
    },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // serialize: shared test DB
    testTimeout: 30_000,
  },
});
