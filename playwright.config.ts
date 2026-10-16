import { defineConfig, devices } from "@playwright/test";

// E2E against a production build. `pnpm test:e2e` resets the database given by
// TEST_DATABASE_URL / TEST_DATABASE_MIGRATION_URL before starting.
const PORT = Number(process.env.E2E_PORT ?? 3200);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    {
      name: "desktop",
      testIgnore: "**/mobile.spec.ts",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
    },
    {
      name: "mobile",
      testMatch: "**/mobile.spec.ts",
      use: { ...devices["Pixel 7"], launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-tests-secret-0123456789abcdefghij",
      ALLOW_SIGNUP: "true",
      LOG_LEVEL: "warn",
    },
  },
});
