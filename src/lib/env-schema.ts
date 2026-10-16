import { z } from "zod";

export const databaseUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
});

export const logLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info");

// HMAC key for rate-limit and audit digests (e-mail/IP never stored in clear text).
export const authSecretSchema = z.string().min(32);

export const booleanFlagSchema = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

export function parseEnv<T>(key: string, value: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(value);
  // Zod issues can include input values; expose only the variable name.
  if (!result.success) throw new Error(`Invalid or missing environment variable: ${key}`);
  return result.data;
}
