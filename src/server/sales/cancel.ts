import "server-only";
import { and, eq } from "drizzle-orm";
import { cashSessions, paymentIntents, saleRefundItems, saleRefunds, sales } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, can } from "@/server/authz/guard";
import { postCashMovementInTx } from "@/server/cash/ledger";
import { forbidden, invalid, isUniqueViolation } from "@/server/errors";
import { applyIntentStatus } from "@/server/payments/intents";
import { getPaymentProvider } from "@/server/payments/registry";
import { toDbQuantity } from "@/server/inventory/quantity";
import { assertFeature } from "@/server/plans/entitlements";
import { parse } from "./checks";
import { cancelSchema } from "./refund-schemas";
import { findRefundByKey, lockSaleForRefund, REFUND_KEY_CONSTRAINT, replayOf, restockLine } from "./refund";

// Cancellation of a whole sale while its cash session is still open: every
// payment is reversed by its original means (cash from that session, external
// card with the reversal NSU, provider payments through the provider refund),
// items optionally go back to stock and the sale becomes "cancelled".

export async function cancelSale(context: TenantContext, saleId: string, rawInput: unknown): Promise<{ refundId: string; replayed: boolean }> {
  assertCan(context, "sales.cancel");
  const input = parse(cancelSchema, rawInput);
  const orgId = context.organization.id;
  let providerRefunds: { reference: string; amountCents: number }[] = [];
  let outcome: { refundId: string; replayed: boolean };
  try {
    outcome = await withScope(dbScope(context), async (tx) => {
      await assertFeature(tx, orgId, "pos");
      const previous = await findRefundByKey(tx, orgId, input.idempotencyKey);
      if (previous) return replayOf(previous, saleId);
      const locked = await lockSaleForRefund(tx, context, saleId, input.idempotencyKey);
      if (locked.replay) return locked.replay;
      const { sale } = locked;
      // Operators without sales.read only see (and so only cancel) their own sales; managers any in scope.
      if (!can(context, "sales.read") && sale.operatorUserId !== context.user.id) throw forbidden();
      if (locked.refundedCents > 0) throw invalid("A venda já tem devolução; registre o restante como devolução.");
      const [session] = await tx
        .select({ status: cashSessions.status })
        .from(cashSessions)
        .where(and(eq(cashSessions.organizationId, orgId), eq(cashSessions.id, sale.cashSessionId!)))
        .for("update");
      if (session?.status !== "open") throw invalid("O caixa desta venda já foi fechado: registre uma devolução.");

      const cashCents = locked.payments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amountCents, 0);
      const hasCard = locked.payments.some((payment) => payment.method === "card_external");
      if (hasCard && !input.cardRefundNsu) throw invalid("Revise os campos destacados.", { cardRefundNsu: ["Informe o NSU do estorno na maquininha."] });
      providerRefunds = locked.payments
        .filter((payment) => payment.method === "pix" || payment.method === "card_provider")
        .map((payment) => ({ reference: payment.providerReference ?? "", amountCents: payment.amountCents }));
      const provider = getPaymentProvider();
      if (providerRefunds.length > 0 && !provider) throw invalid("O estorno do pagamento integrado não está disponível agora. Tente mais tarde.");

      const [refund] = await tx
        .insert(saleRefunds)
        .values({
          organizationId: orgId,
          saleId: sale.id,
          storeId: sale.storeId,
          kind: "cancellation",
          reason: input.reason,
          method: "original",
          nsu: input.cardRefundNsu ?? null,
          amountCents: sale.totalCents,
          cashAmountCents: cashCents,
          idempotencyKey: input.idempotencyKey,
          cashSessionId: sale.cashSessionId,
          providerStatus: providerRefunds.length > 0 ? "requested" : null,
          createdBy: context.user.id,
        })
        .returning({ id: saleRefunds.id });
      // Item amounts add up to the sale total: the last line takes the rounding remainder.
      const amounts = new Map(locked.items.map((item) => [item.id, item.effectiveCents]));
      const last = locked.items[locked.items.length - 1];
      amounts.set(last.id, last.effectiveCents + sale.totalCents - locked.items.reduce((sum, item) => sum + item.effectiveCents, 0));
      const ordered = [...locked.items].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
      for (const item of ordered) {
        const movementId = input.restock ? await restockLine(tx, context, sale.storeId, item.variantId, item.soldMilli, `Cancelamento da venda nº ${sale.number}`) : null;
        await tx.insert(saleRefundItems).values({
          organizationId: orgId,
          refundId: refund.id,
          saleItemId: item.id,
          quantity: toDbQuantity(item.soldMilli),
          amountCents: amounts.get(item.id)!,
          restocked: input.restock,
          movementId,
        });
      }
      if (cashCents > 0) {
        await postCashMovementInTx(tx, orgId, { sessionId: sale.cashSessionId!, storeId: sale.storeId, type: "refund", amountCents: cashCents, actorUserId: context.user.id, reference: { kind: "refund", id: refund.id } });
      }
      await tx.update(sales).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(sales.organizationId, orgId), eq(sales.id, sale.id)));
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "sale.cancelled",
        entityType: "sale_refund",
        entityId: refund.id,
        storeId: sale.storeId,
        changes: { saleId: sale.id, number: sale.number, amountCents: sale.totalCents, cashCents, restock: input.restock, reason: input.reason },
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
  if (outcome.replayed || providerRefunds.length === 0) return outcome;

  // Provider refunds run after the commit (no external call holds database locks).
  const provider = getPaymentProvider();
  for (const refund of providerRefunds) {
    try {
      const answer = await provider!.refund(refund.reference, refund.amountCents, `${outcome.refundId}:${refund.reference}`);
      if (answer.status !== "refunded") continue;
      await withScope(dbScope(context), async (tx) => {
        const [intent] = await tx
          .select({ id: paymentIntents.id })
          .from(paymentIntents)
          .where(and(eq(paymentIntents.organizationId, orgId), eq(paymentIntents.provider, provider!.key), eq(paymentIntents.providerReference, refund.reference)));
        if (intent) {
          await applyIntentStatus(tx, orgId, intent.id, { provider: provider!.key, eventId: `refund:${answer.refundReference}`, status: "refunded", amountCents: refund.amountCents, source: "query" });
        }
      });
    } catch (error) {
      // The intent stays confirmed; the refund record shows "requested" for follow-up with the provider.
      logger.warn({ provider: provider!.key, err: { name: (error as Error)?.name } }, "Provider refund failed");
    }
  }
  return outcome;
}
