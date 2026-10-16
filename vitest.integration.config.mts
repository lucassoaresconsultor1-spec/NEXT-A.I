import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration suite: real PostgreSQL, migrations applied by globalSetup.
// Requires TEST_DATABASE_URL (app role, no BYPASSRLS) and
// TEST_DATABASE_MIGRATION_URL (schema owner). The database is reset each run.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
