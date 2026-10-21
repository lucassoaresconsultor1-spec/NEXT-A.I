import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { saleItems, salePayments, saleRefundItems, saleRefunds, sales } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, can } from "@/server/authz/guard";
import { postCashMovementInTx } from "@/server/cash/ledger";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { postLedgerEntry } from "@/server/inventory/ledger";
import { fromDbQuantity, toDbQuantity } from "@/server/inventory/quantity";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import { lockOwnOpenSession, parse } from "./checks";
import { salesVisibility } from "./queries";
import { effectiveLineCents, lineReturnCents, refundSchema, REFUND_WINDOW_DAYS } from "./refund-schemas";

// Returns of sale items (any day within the window): refund by cash (the
// operator's open session) or by the external card machine (NSU), optional
// restock, append-only records. Shared helpers are also used by cancel.ts.

const SALE_NOT_FOUND = () => notFound("Venda não encontrada.");
export const REFUND_KEY_CONSTRAINT = "sale_refunds_org_key_key";

export async function findRefundByKey(tx: Tx, organizationId: string, key: string) {
  const [row] = await tx
    .select({ id: saleRefunds.id, saleId: saleRefunds.saleId })
    .from(saleRefunds)
    .where(and(eq(saleRefunds.organizationId, organizationId), eq(saleRefunds.idempotencyKey, key)));
  return row ?? null;
}

/** Answer for a key already used: the same refund, or a conflict when the key belongs to another sale. */
export function replayOf(previous: { id: string; saleId: string }, saleId: string) {
  if (previous.saleId !== saleId) throw conflict("Esta chave já foi usada em outra venda.");
  return { refundId: previous.id, replayed: true };
}

/**
 * Locks a sale visible to the member and loads what refunds need. The idempotency key is
 * checked again under the sale lock, so a concurrent call with the same key gets the first
 * refund (replay) instead of failing the validations after it committed.
 */
export async function lockSaleForRefund(tx: Tx, context: TenantContext, saleId: string, idempotencyKey: string) {
  if (!isUuid(saleId)) throw SALE_NOT_FOUND();
  const orgId = context.organization.id;
  const [sale] = await tx
    .select({
      id: sales.id,
      number: sales.number,
      status: sales.status,
      storeId: sales.storeId,
      cashSessionId: sales.cashSessionId,
      operatorUserId: sales.operatorUserId,
      totalCents: sales.totalCents,
      completedAt: sales.completedAt,
    })
    .from(sales)
    .where(and(eq(sales.organizationId, orgId), eq(sales.id, saleId), salesVisibility(context)))
    .for("update");
  if (!sale) throw SALE_NOT_FOUND();
  const previous = await findRefundByKey(tx, orgId, idempotencyKey);
  if (previous) return { replay: replayOf(previous, saleId) };
  if (sale.status === "cancelled") throw invalid("Esta venda já foi cancelada.");
  if (sale.status !== "completed") throw invalid("Só vendas finalizadas podem ser canceladas ou devolvidas.");
  const items = await tx
    .select({ id: saleItems.id, line: saleItems.line, variantId: saleItems.variantId, unit: saleItems.unit, quantity: saleItems.quantity, totalCents: saleItems.totalCents })
    .from(saleItems)
    .where(and(eq(saleItems.organizationId, orgId), eq(saleItems.saleId, saleId)))
    .orderBy(asc(saleItems.line));
  const returned = await tx
    .select({
      saleItemId: saleRefundItems.saleItemId,
      quantity: sql<string>`coalesce(sum(${saleRefundItems.quantity}), 0)::text`,
      amountCents: sql<number>`coalesce(sum(${saleRefundItems.amountCents}), 0)`.mapWith(Number),
    })
    .from(saleRefundItems)
    .innerJoin(saleRefunds, and(eq(saleRefunds.organizationId, saleRefundItems.organizationId), eq(saleRefunds.id, saleRefundItems.refundId)))
    .where(and(eq(saleRefundItems.organizationId, orgId), eq(saleRefunds.saleId, saleId)))
    .groupBy(saleRefundItems.saleItemId);
  const [refunded] = await tx
    .select({ value: sql<number>`coalesce(sum(${saleRefunds.amountCents}), 0)`.mapWith(Number) })
    .from(saleRefunds)
    .where(and(eq(saleRefunds.organizationId, orgId), eq(saleRefunds.saleId, saleId)));
  const payments = await tx
    .select({ method: salePayments.method, amountCents: salePayments.amountCents, providerReference: salePayments.providerReference })
    .from(salePayments)
    .where(and(eq(salePayments.organizationId, orgId), eq(salePayments.saleId, saleId)));
  const byItem = new Map(returned.map((row) => [row.saleItemId, { milli: fromDbQuantity(row.quantity), cents: row.amountCents }]));
  const sumNets = items.reduce((sum, item) => sum + item.totalCents, 0);
  return {
    replay: null,
    sale,
    payments,
    refundedCents: refunded.value,
    items: items.map((item) => ({
      ...item,
      soldMilli: fromDbQuantity(item.quantity),
      returnedMilli: byItem.get(item.id)?.milli ?? BigInt(0),
      refundedCents: byItem.get(item.id)?.cents ?? 0,
      effectiveCents: effectiveLineCents(item.totalCents, sumNets, sale.totalCents),
    })),
  };
}

/** Restocks (entry in the ledger) when asked; returns the movement id or null. */
export async function restockLine(tx: Tx, context: TenantContext, storeId: string, variantId: string, quantityMilli: bigint, reason: string) {
  const movement = await postLedgerEntry(tx, context, { storeId, variantId, type: "entry", quantityMilli, reason, allowInactive: true });
  return movement.id;
}

export async function refundSale(context: TenantContext, saleId: string, rawInput: unknown): Promise<{ refundId: string; replayed: boolean }> {
  assertCan(context, "sales.refund");
  const input = parse(refundSchema, rawInput);
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      await assertFeature(tx, orgId, "pos");
      const previous = await findRefundByKey(tx, orgId, input.idempotencyKey);
      if (previous) return replayOf(previous, saleId);
      const locked = await lockSaleForRefund(tx, context, saleId, input.idempotencyKey);
      if (locked.replay) return locked.replay;
      const { sale } = locked;
      const ageDays = (Date.now() - (sale.completedAt?.getTime() ?? Date.now())) / 86_400_000;
      if (ageDays > REFUND_WINDOW_DAYS && !can(context, "sales.refund.override")) {
        throw forbidden(`Devolução fora do prazo de ${REFUND_WINDOW_DAYS} dias. Peça a um gerente.`);
      }
      const sessionId = input.method === "cash" ? await lockOwnOpenSession(tx, context, sale.storeId) : null;

      const errors: Record<string, string[]> = {};
      const lines = input.items.map((entry, index) => {
        const item = locked.items.find((candidate) => candidate.line === entry.line);
        if (!item) {
          errors[`items.${index}.line`] = ["Item não pertence a esta venda."];
          return null;
        }
        const available = item.soldMilli - item.returnedMilli;
        if (entry.quantity > available) errors[`items.${index}.quantity`] = [`Pode devolver no máximo ${toDbQuantity(available)}.`];
        else if (item.unit === "un" && entry.quantity % BigInt(1000) !== BigInt(0)) errors[`items.${index}.quantity`] = ["Somente números inteiros."];
        return { entry, item, amountCents: lineReturnCents(item.effectiveCents, item.soldMilli, item.returnedMilli, item.refundedCents, entry.quantity) };
      });
      if (Object.keys(errors).length > 0) throw invalid("Revise os itens destacados.", errors);
      const valid = lines.filter((line): line is NonNullable<typeof line> => line !== null);
      let amountCents = valid.reduce((sum, line) => sum + line.amountCents, 0);
      // The return that completes the whole sale refunds exactly what is left of the total.
      const completes = locked.items.every((item) => {
        const line = valid.find((entry) => entry.item.id === item.id);
        return item.returnedMilli + (line?.entry.quantity ?? BigInt(0)) >= item.soldMilli;
      });
      if (completes) {
        const rest = sale.totalCents - locked.refundedCents;
        valid[valid.length - 1].amountCents += rest - amountCents;
        amountCents = rest;
      }
      if (amountCents <= 0) throw invalid("Não há valor a devolver nestes itens.");

      const [refund] = await tx
        .insert(saleRefunds)
        .values({
          organizationId: orgId,
          saleId: sale.id,
          storeId: sale.storeId,
          kind: "return",
          reason: input.reason,
          method: input.method,
          nsu: input.nsu ?? null,
          amountCents,
          cashAmountCents: input.method === "cash" ? amountCents : 0,
          idempotencyKey: input.idempotencyKey,
          cashSessionId: sessionId,
          createdBy: context.user.id,
        })
        .returning({ id: saleRefunds.id });
      const ordered = [...valid].sort((a, b) => (a.item.variantId < b.item.variantId ? -1 : a.item.variantId > b.item.variantId ? 1 : 0));
      for (const line of ordered) {
        const movementId = line.entry.restock ? await restockLine(tx, context, sale.storeId, line.item.variantId, line.entry.quantity, `Devolução da venda nº ${sale.number}`) : null;
        await tx.insert(saleRefundItems).values({
          organizationId: orgId,
          refundId: refund.id,
          saleItemId: line.item.id,
          quantity: toDbQuantity(line.entry.quantity),
          amountCents: line.amountCents,
          restocked: line.entry.restock,
          movementId,
        });
      }
      if (sessionId) {
        await postCashMovementInTx(tx, orgId, { sessionId, storeId: sale.storeId, type: "refund", amountCents, actorUserId: context.user.id, reference: { kind: "refund", id: refund.id } });
      }
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "sale.refunded",
        entityType: "sale_refund",
        entityId: refund.id,
        storeId: sale.storeId,
        changes: {
          saleId: sale.id,
          number: sale.number,
          amountCents,
          method: input.method,
          reason: input.reason,
          items: valid.map((line) => ({ line: line.item.line, quantity: toDbQuantity(line.entry.quantity), amountCents: line.amountCents, restocked: line.entry.restock })),
        },
      });
      return { refundId: refund.id, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error, REFUND_KEY_CONSTRAINT)) {
      const previous = await withScope(dbScope(context), (tx) => findRefundByKey(tx, orgId, input.idempotencyKey));
      if (previous) return replayOf(previous, saleId);
    }
    throw error;
  }
}
