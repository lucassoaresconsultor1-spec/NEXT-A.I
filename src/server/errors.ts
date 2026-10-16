// Domain errors carry a safe, user-facing message in pt-BR. Anything else is
// treated as unexpected: logged on the server and shown as a generic failure.

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: "forbidden" | "not_found" | "conflict" | "invalid" | "limit" | "unauthenticated",
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const forbidden = (message = "Você não tem permissão para esta ação.") => new DomainError(message, "forbidden");

export const notFound = (message = "Registro não encontrado.") => new DomainError(message, "not_found");

export const conflict = (message: string, fieldErrors?: Record<string, string[]>) =>
  new DomainError(message, "conflict", fieldErrors);

export const invalid = (message: string, fieldErrors?: Record<string, string[]>) =>
  new DomainError(message, "invalid", fieldErrors);

export const limitReached = (message: string) => new DomainError(message, "limit");

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** PostgreSQL unique_violation, used to turn races into friendly conflicts. */
export function isUniqueViolation(error: unknown, constraint?: string) {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pg = cause as { code?: string; constraint?: string };
  return pg?.code === "23505" && (!constraint || pg.constraint === constraint);
}
