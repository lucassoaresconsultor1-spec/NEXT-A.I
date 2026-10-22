import "server-only";
import { logger } from "@/lib/logger";
import { getDb } from "./index";
import { opsEvents } from "./schema";

// Records an operational event (m25) outside any tenant transaction. Best effort:
// a failure here is logged and never breaks the operation being measured.

export function recordOpsEvent(event: { kind: "error" | "slow_transaction"; organizationId: string | null; name: string; durationMs?: number }) {
  return getDb()
    .insert(opsEvents)
    .values({ kind: event.kind, organizationId: event.organizationId, name: event.name.slice(0, 120), durationMs: event.durationMs ?? null })
    .then(
      () => undefined,
      (error: unknown) => logger.warn({ err: { name: (error as Error)?.name } }, "Ops event not recorded"),
    );
}
