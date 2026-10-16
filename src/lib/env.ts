import "server-only";
import { authSecretSchema, booleanFlagSchema, databaseUrlSchema, logLevelSchema, parseEnv } from "./env-schema";

export function getDatabaseUrl() {
  return parseEnv("DATABASE_URL", process.env.DATABASE_URL, databaseUrlSchema);
}

export function getLogLevel() {
  return parseEnv("LOG_LEVEL", process.env.LOG_LEVEL, logLevelSchema);
}

export function getAuthSecret() {
  return parseEnv("AUTH_SECRET", process.env.AUTH_SECRET, authSecretSchema);
}

/** Self-service company sign-up; operators can close it with ALLOW_SIGNUP=false. */
export function isSignupAllowed() {
  return parseEnv("ALLOW_SIGNUP", process.env.ALLOW_SIGNUP || undefined, booleanFlagSchema);
}

export function isProduction() {
  return process.env.NODE_ENV === "production";
}
