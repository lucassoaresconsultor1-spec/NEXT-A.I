import "server-only";
import type { Tx } from "@/db/tenant";
import { auditLogs } from "@/db/schema";

export interface AuditEntry {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  storeId?: string | null;
  /** Business fields only. Passwords, tokens and full payloads never belong here. */
  changes?: Record<string, unknown>;
}

/** Writes inside the caller's transaction, so the trail commits or rolls back with the change. */
export async function recordAudit(tx: Tx, entry: AuditEntry) {
  await tx.insert(auditLogs).values({
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    storeId: entry.storeId ?? null,
    changes: entry.changes ?? null,
  });
}

/** Field-level diff of plain values, limited to the keys the caller lists. */
export function diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>, keys: readonly (keyof T)[]) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    if (!(key in after)) continue;
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (from !== to) changes[String(key)] = { from, to };
  }
  return changes;
}
