import { afterEach, describe, expect, it, vi } from "vitest";
import { getDatabaseUrl, getLogLevel } from "./env";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllEnvs());

describe("server environment", () => {
  it("does not require a database URL to read independent configuration", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("LOG_LEVEL", undefined);
    expect(getLogLevel()).toBe("info");
    expect(() => getDatabaseUrl()).toThrow("DATABASE_URL");
  });

  it("accepts PostgreSQL connection protocols", () => {
    for (const protocol of ["postgres", "postgresql"]) {
      const value = `${protocol}://app:development@localhost:5432/app`;
      vi.stubEnv("DATABASE_URL", value);
      expect(getDatabaseUrl()).toBe(value);
    }
  });

  it("rejects a wrong protocol without exposing its credentials", () => {
    vi.stubEnv("DATABASE_URL", "https://app:sensitive-test-value@example.invalid/db");
    expect(() => getDatabaseUrl()).toThrow("DATABASE_URL");
    expect(() => getDatabaseUrl()).not.toThrow("sensitive-test-value");
  });

  it("rejects malformed URLs and invalid log levels", () => {
    vi.stubEnv("DATABASE_URL", "not a URL");
    vi.stubEnv("LOG_LEVEL", "not-a-level");
    expect(() => getDatabaseUrl()).toThrow("DATABASE_URL");
    expect(() => getLogLevel()).toThrow("LOG_LEVEL");
  });
});
