import { afterAll } from "vitest";
import { closeDatabase } from "@/db";

// Services read DATABASE_URL; point them at the disposable test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_SECRET ??= "integration-tests-secret-0123456789abcdef";
process.env.LOG_LEVEL ??= "silent";

afterAll(async () => {
  await closeDatabase();
});
