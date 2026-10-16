import { z } from "zod";

export const PAGE_SIZE = 25;

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

export function parsePage(value: unknown) {
  return pageSchema.parse(value ?? 1);
}

export function pageWindow(page: number, size = PAGE_SIZE) {
  return { limit: size, offset: (page - 1) * size };
}

export function pageResult<T>(rows: T[], total: number, page: number, size = PAGE_SIZE) {
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / size)) };
}

/** Accepts only whitelisted sort columns from the URL. */
export function parseSort<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseDirection(value: unknown): "asc" | "desc" {
  return value === "desc" ? "desc" : "asc";
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function likePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
