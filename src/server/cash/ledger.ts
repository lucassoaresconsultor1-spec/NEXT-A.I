import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { cashMovements, cashSessions } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { formatCurrencyCents } from "@/lib/format";
import { invalid, notFound } from "@/server/errors";

// Cash ledger of a session: expected cash = opening + supplies − withdrawals +
// cash sales − cash refunds, always computed from the movements on the server.

export const SESSION_NOT_FOUND = () => notFound("Sessão de caixa não encontrada.");

export interface CashTotals {
  openingCents: number;
  suppliesCents: number;
  withdrawalsCents: number;
  salesCents: number;
  refundsCents: number;
  expectedCents: number;
}

const sumOf = (type: string) =>
  sql<number>`coalesce(sum(case when ${cashMovements.type} = ${type} then ${cashMovements.amountCents} else 0 end), 0)`.mapWith(Number);

export async function sessionTotals(tx: Tx, organizationId: string, sessionId: string): Promise<CashTotals> {
  const [row] = await tx
    .select({
      openingCents: sumOf("opening"),
      suppliesCents: sumOf("supply"),
      withdrawalsCents: sumOf("withdrawal"),
      salesCents: sumOf("sale"),
      refundsCents: sumOf("refund"),
    })
    .from(cashMovements)
    .where(and(eq(cashMovements.organizationId, organizationId), eq(cashMovements.sessionId, sessionId)));
  const expectedCents = row.openingCents + row.suppliesCents - row.withdrawalsCents + row.salesCents - row.refundsCents;
  return { ...row, expectedCents };
}

/** Expected cash of a session from its movements (same formula as closing). */
export async function expectedCashCents(tx: Tx, organizationId: string, sessionId: string) {
  return (await sessionTotals(tx, organizationId, sessionId)).expectedCents;
}

/** Refuses taking out more cash than the session is expected to hold. */
export async function assertCashAvailable(tx: Tx, organizationId: string, sessionId: string, amountCents: number, field: string) {
  const expected = await expectedCashCents(tx, organizationId, sessionId);
  if (amountCents > expected) {
    throw invalid("Revise os campos destacados.", { [field]: [`Valor acima do dinheiro disponível no caixa (${formatCurrencyCents(expected)}).`] });
  }
}

/** For m06a/m08: locks the open session of the store and inserts a sale or refund cash movement. No permission check. */
export async function postCashMovementInTx(
  tx: Tx,
  organizationId: string,
  input: { sessionId: string; storeId: string; type: "sale" | "refund"; amountCents: number; actorUserId: string; reference: { kind: "sale" | "refund"; id: string } },
) {
  const [session] = await tx
    .select({ status: cashSessions.status, storeId: cashSessions.storeId })
    .from(cashSessions)
    .where(and(eq(cashSessions.organizationId, organizationId), eq(cashSessions.id, input.sessionId)))
    .for("update");
  if (!session || session.storeId !== input.storeId) throw SESSION_NOT_FOUND();
  if (session.status !== "open") throw invalid("A sessão de caixa está fechada.");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw invalid("Valor em dinheiro inválido.");
  if (input.type === "refund") await assertCashAvailable(tx, organizationId, input.sessionId, input.amountCents, "amountCents");
  const [movement] = await tx
    .insert(cashMovements)
    .values({
      organizationId,
      sessionId: input.sessionId,
      storeId: input.storeId,
      type: input.type,
      amountCents: input.amountCents,
      referenceKind: input.reference.kind,
      referenceId: input.reference.id,
      createdBy: input.actorUserId,
    })
    .returning({ id: cashMovements.id });
  return { movementId: movement.id };
}
