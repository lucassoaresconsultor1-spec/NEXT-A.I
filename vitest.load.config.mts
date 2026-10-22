import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Load tests (m42): critical flows under concurrency against the disposable test
// database (same setup as the integration suite, which resets it).
// Run: pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm exec vitest run --config vitest.load.config.mts
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/load/**/*.load.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
