import { defineConfig } from "vitest/config";

/**
 * These are integration tests, not unit tests: there is no local Supabase
 * here (no Docker in this environment for `supabase start`), so every test
 * runs against the same remote dev project the app itself points at. They
 * never touch the accounts a person actually uses - see tests/fixtures.ts -
 * and each suite cleans up the orders/rows it creates.
 *
 * `fileParallelism: false` because the fixtures file establishes shared test
 * accounts once, and Postgres connection/auth-rate-limit behavior gets
 * flaky if multiple files try to sign in as the same fixture account
 * concurrently.
 */
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
