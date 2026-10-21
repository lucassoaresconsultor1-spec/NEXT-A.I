import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { documentCounters } from "@/db/schema";
import type { Tx } from "@/db/tenant";

/**
 * Next document number for (organization, scope), starting at 1, inside the
 * caller's transaction. The counter row stays locked until commit, so concurrent
 * documents of the same scope are numbered in order and a rollback gives the
 * number back (ADR-014).
 */
export async function nextDocumentNumber(tx: Tx, organizationId: string, scope: string): Promise<number> {
  await tx.insert(documentCounters).values({ organizationId, scope }).onConflictDoNothing();
  const [row] = await tx
    .update(documentCounters)
    .set({ lastValue: sql`${documentCounters.lastValue} + 1` })
    .where(and(eq(documentCounters.organizationId, organizationId), eq(documentCounters.scope, scope)))
    .returning({ value: documentCounters.lastValue });
  return row.value;
}
