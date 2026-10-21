import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { paymentIntents, saleItems, salePayments, sales } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { formatCurrencyCents } from "@/lib/format";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope, can } from "@/server/authz/guard";
import { postCashMovementInTx } from "@/server/cash/ledger";
import { nextDocumentNumber } from "@/server/counters";
import { loadActiveCustomer } from "@/server/customers/service";
import { conflict, forbidden, invalid, isDomainError, isUniqueViolation, notFound } from "@/server/errors";
import { postLedgerEntry } from "@/server/inventory/ledger";
import { fromDbQuantity, isWholeQuantity, toDbQuantity } from "@/server/inventory/quantity";
import { consumeReservation } from "@/server/inventory/reservations";
import { assertFeature } from "@/server/plans/entitlements";
import { formatBpsInput } from "@/server/settings/schemas";
import { loadEffectiveSettings } from "@/server/settings/service";
import { isUuid } from "@/server/stores/schemas";
import { assertSalesperson, assertStoreActive, byVariant, loadVariants, lockOwnOpenSession, parse } from "./checks";
import { cashChange, discountBps, lineTotals, saleTotals } from "./pricing";
import { completeSaleSchema, type ParsedCompleteSale } from "./schemas";

// Sale completion (ADR-013/014/016): one transaction writes the sale, its items
// with price and cost snapshots, the payments, the stock exits, the cash
// movement and the store number. The completion key makes retries return the
// same sale without repeating anything.

type Outcome = { saleId: string; number: number; totalCents: number; changeCents: number; replayed: boolean };
const KEY_CONSTRAINT = "sales_org_completion_key_key";

async function findByKey(tx: Tx, organizationId: string, completionKey: string) {
  const [row] = await tx
    .select({ id: sales.id, number: sales.number, totalCents: sales.totalCents, changeCents: sales.changeCents })
    .from(sales)
    .where(and(eq(sales.organizationId, organizationId), eq(sales.completionKey, completionKey)));
  return row ?? null;
}

/** For the POS to confirm a finalization whose answer was lost. Only the member's own sales. */
export async function findSaleByCompletionKey(context: TenantContext, completionKey: string) {
  assertCan(context, "sales.create");
  if (!isUuid(completionKey)) return null;
  const row = await withScope(dbScope(context), (tx) => findByKey(tx, context.organization.id, completionKey));
  return row?.number ? { saleId: row.id, number: row.number } : null;
}

function itemErrors(input: ParsedCompleteSale, variants: Awaited<ReturnType<typeof loadVariants>>) {
  const errors: Record<string, string[]> = {};
  const priceChanges: Record<string, string[]> = {};
  input.items.forEach((item, index) => {
    const variant = variants.get(item.variantId);
    if (!variant?.sellable) errors[`items.${index}.variantId`] = ["Produto indisponível para venda."];
    else if (variant.priceCents === null) errors[`items.${index}.variantId`] = ["Produto sem preço de venda."];
    else if (variant.unit === "un" && !isWholeQuantity(item.quantity)) errors[`items.${index}.quantity`] = ["Somente números inteiros."];
    else if (variant.priceCents !== item.expectedUnitPriceCents) priceChanges[`items.${index}.expectedUnitPriceCents`] = [`Preço atual: ${formatCurrencyCents(variant.priceCents)}.`];
  });
  if (Object.keys(errors).length > 0) throw invalid("Revise os itens destacados.", errors);
  if (Object.keys(priceChanges).length > 0) throw conflict("O preço de um ou mais itens mudou. Revise a venda.", priceChanges);
}

function assertDiscountAllowed(context: TenantContext, discountCents: number, subtotalCents: number, ceilingBps: number, surchargeCents: number) {
  if (discountCents > 0) {
    if (!can(context, "sales.discount")) throw forbidden("Seu perfil não pode dar desconto.");
    if (discountBps(discountCents, subtotalCents) > ceilingBps && !can(context, "sales.discount.override")) {
      throw forbidden(`Desconto acima do teto da loja (${formatBpsInput(ceilingBps)} %). Peça a um gerente.`);
    }
  }
  if (surchargeCents > 0 && !can(context, "sales.surcharge")) throw forbidden("Seu perfil não pode aplicar acréscimo.");
}

/** Resumed suspended sale: same store, still suspended, same items and quantities. Returns its item rows. */
async function lockSuspended(tx: Tx, organizationId: string, saleId: string, input: ParsedCompleteSale) {
  const [sale] = await tx
    .select({ status: sales.status, storeId: sales.storeId })
    .from(sales)
    .where(and(eq(sales.organizationId, organizationId), eq(sales.id, saleId)))
    .for("update");
  if (!sale || sale.storeId !== input.storeId) throw notFound("Venda não encontrada.");
  if (sale.status !== "suspended") throw invalid("Esta venda já não está suspensa.");
  const rows = await tx
    .select({ id: saleItems.id, line: saleItems.line, variantId: saleItems.variantId, quantity: saleItems.quantity, reservationId: saleItems.reservationId })
    .from(saleItems)
    .where(and(eq(saleItems.organizationId, organizationId), eq(saleItems.saleId, saleId)))
    .orderBy(asc(saleItems.line));
  const same =
    rows.length === input.items.length &&
    input.items.every((item) => rows.some((row) => row.variantId === item.variantId && fromDbQuantity(row.quantity) === item.quantity));
  if (!same) throw invalid("A venda suspensa foi alterada; retome-a de novo.");
  return rows;
}

/** Provider payments must use confirmed, unused intents of this store, operator, session and amount. */
async function lockConfirmedIntents(tx: Tx, context: TenantContext, input: ParsedCompleteSale, sessionId: string) {
  const references = new Map<string, string | null>();
  for (const [index, payment] of input.payments.entries()) {
    if (payment.method !== "pix" && payment.method !== "card_provider") continue;
    const [intent] = await tx
      .select({
        status: paymentIntents.status,
        method: paymentIntents.method,
        amountCents: paymentIntents.amountCents,
        storeId: paymentIntents.storeId,
        operatorUserId: paymentIntents.operatorUserId,
        cashSessionId: paymentIntents.cashSessionId,
        saleId: paymentIntents.saleId,
        providerReference: paymentIntents.providerReference,
      })
      .from(paymentIntents)
      .where(and(eq(paymentIntents.organizationId, context.organization.id), eq(paymentIntents.id, payment.paymentIntentId)))
      .for("update");
    const field = `payments.${index}.paymentIntentId`;
    if (!intent || intent.storeId !== input.storeId || intent.operatorUserId !== context.user.id || intent.cashSessionId !== sessionId || intent.method !== payment.method) {
      throw invalid("Revise os pagamentos.", { [field]: ["Pagamento integrado não encontrado neste caixa."] });
    }
    if (intent.saleId) throw invalid("Revise os pagamentos.", { [field]: ["Este pagamento já foi usado em outra venda."] });
    if (intent.status === "pending") throw invalid("Revise os pagamentos.", { [field]: ["Aguardando a confirmação do pagamento."] });
    if (intent.status !== "confirmed") throw invalid("Revise os pagamentos.", { [field]: ["Este pagamento não foi aprovado."] });
    if (intent.amountCents !== payment.amountCents) throw invalid("Revise os pagamentos.", { [field]: ["O valor não confere com o pagamento aprovado."] });
    references.set(payment.paymentIntentId, intent.providerReference);
  }
  return references;
}

export async function completeSale(context: TenantContext, rawInput: unknown): Promise<Outcome> {
  assertCan(context, "sales.create");
  const input = parse(completeSaleSchema, rawInput);
  assertStoreInScope(context, input.storeId);
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      await assertFeature(tx, orgId, "pos");
      const previous = await findByKey(tx, orgId, input.completionKey);
      if (previous?.number) return { saleId: previous.id, number: previous.number, totalCents: previous.totalCents, changeCents: previous.changeCents, replayed: true };
      await assertStoreActive(tx, orgId, input.storeId);
      const sessionId = await lockOwnOpenSession(tx, context, input.storeId);
      // Checked again under the session lock: a concurrent retry with the same key sees the committed sale.
      const committed = await findByKey(tx, orgId, input.completionKey);
      if (committed?.number) return { saleId: committed.id, number: committed.number, totalCents: committed.totalCents, changeCents: committed.changeCents, replayed: true };

      const settings = await loadEffectiveSettings(tx, orgId, input.storeId);
      if (settings.customerRequirement === "required" && !input.customerId) throw invalid("Revise os campos destacados.", { customerId: ["Identifique o cliente para vender nesta loja."] });
      if (input.customerId && !(await loadActiveCustomer(tx, orgId, input.customerId))) {
        throw invalid("Revise os campos destacados.", { customerId: ["Selecione um cliente ativo."] });
      }
      if (input.salespersonUserId) await assertSalesperson(tx, orgId, input.salespersonUserId, input.storeId);

      const variants = await loadVariants(tx, orgId, input.items.map((item) => item.variantId));
      itemErrors(input, variants);
      const lines = input.items.map((item) => ({ ...item, variant: variants.get(item.variantId)! }));
      const priced = lines.map((line) => ({ quantityMilli: line.quantity, unitPriceCents: line.variant.priceCents!, discountCents: line.discountCents }));
      const lineErrors: Record<string, string[]> = {};
      priced.forEach((line, index) => {
        if (lineTotals(line).netCents < 0) lineErrors[`items.${index}.discountCents`] = ["O desconto passa do valor do item."];
      });
      if (Object.keys(lineErrors).length > 0) throw invalid("Revise os itens destacados.", lineErrors);
      const totals = saleTotals(priced, input.saleDiscountCents, input.surchargeCents);
      if (totals.totalCents < 0) throw invalid("Revise os campos destacados.", { saleDiscountCents: ["O desconto passa do valor da venda."] });
      assertDiscountAllowed(context, totals.discountCents, totals.subtotalCents, settings.maxDiscountBps, input.surchargeCents);

      const paid = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
      if (paid !== totals.totalCents) {
        throw invalid("Revise os pagamentos.", { payments: [`Os pagamentos somam ${formatCurrencyCents(paid)}, mas o total é ${formatCurrencyCents(totals.totalCents)}.`] });
      }
      const cashCents = input.payments.reduce((sum, payment) => sum + (payment.method === "cash" ? payment.amountCents : 0), 0);
      const changeCents = input.payments.reduce((sum, payment) => sum + (payment.method === "cash" ? cashChange(payment.amountCents, payment.tenderedCents) : 0), 0);

      const providerReferences = await lockConfirmedIntents(tx, context, input, sessionId);
      const suspended = input.suspendedSaleId ? await lockSuspended(tx, orgId, input.suspendedSaleId, input) : null;
      const saleId = input.suspendedSaleId ?? randomUUID();
      const number = await nextDocumentNumber(tx, orgId, `sale:${input.storeId}`);
      const now = new Date();
      const header = {
        number,
        status: "completed" as const,
        completionKey: input.completionKey,
        cashSessionId: sessionId,
        operatorUserId: context.user.id,
        salespersonUserId: input.salespersonUserId ?? null,
        customerId: input.customerId ?? null,
        ...totals,
        changeCents,
        receiptHeader: settings.receiptHeader,
        receiptFooter: settings.receiptFooter,
        note: input.notes ?? null,
        completedAt: now,
        updatedAt: now,
      };
      if (suspended) await tx.update(sales).set(header).where(and(eq(sales.organizationId, orgId), eq(sales.id, saleId)));
      else await tx.insert(sales).values({ id: saleId, organizationId: orgId, storeId: input.storeId, ...header });

      for (const row of suspended ?? []) if (row.reservationId) await consumeReservation(tx, orgId, row.reservationId);
      const indexOf = new Map(input.items.map((item, index) => [item.variantId, index]));
      for (const line of byVariant(lines)) {
        const index = indexOf.get(line.variantId)!;
        let movementId: string;
        try {
          movementId = (await postLedgerEntry(tx, context, { storeId: input.storeId, variantId: line.variantId, type: "exit", quantityMilli: line.quantity, reason: `Venda nº ${number}` })).id;
        } catch (error) {
          if (isDomainError(error) && error.fieldErrors?.quantity) throw invalid("Estoque insuficiente.", { [`items.${index}.quantity`]: error.fieldErrors.quantity });
          throw error;
        }
        const { netCents } = lineTotals(priced[index]);
        const values = {
          productName: line.variant.productName,
          variantName: line.variant.variantName,
          sku: line.variant.sku,
          unit: line.variant.unit,
          quantity: toDbQuantity(line.quantity),
          unitPriceCents: line.variant.priceCents!,
          unitCostCents: line.variant.costCents,
          discountCents: line.discountCents,
          totalCents: netCents,
          movementId,
        };
        const existing = suspended?.find((row) => row.variantId === line.variantId);
        if (existing) await tx.update(saleItems).set(values).where(and(eq(saleItems.organizationId, orgId), eq(saleItems.id, existing.id)));
        else await tx.insert(saleItems).values({ organizationId: orgId, saleId, line: index + 1, variantId: line.variantId, ...values });
      }
      if (cashCents > 0) {
        await postCashMovementInTx(tx, orgId, { sessionId, storeId: input.storeId, type: "sale", amountCents: cashCents, actorUserId: context.user.id, reference: { kind: "sale", id: saleId } });
      }
      await tx.insert(salePayments).values(
        input.payments.map((payment) => ({
          organizationId: orgId,
          saleId,
          method: payment.method,
          status: "confirmed" as const,
          amountCents: payment.amountCents,
          ...(payment.method === "cash"
            ? { tenderedCents: payment.tenderedCents, changeCents: cashChange(payment.amountCents, payment.tenderedCents) }
            : payment.method === "card_external"
              ? { nsu: payment.nsu, brand: payment.brand ?? null }
              : { providerReference: providerReferences.get(payment.paymentIntentId) ?? null }),
          createdBy: context.user.id,
        })),
      );
      for (const payment of input.payments) {
        if (payment.method !== "pix" && payment.method !== "card_provider") continue;
        await tx.update(paymentIntents).set({ saleId, updatedAt: now }).where(and(eq(paymentIntents.organizationId, orgId), eq(paymentIntents.id, payment.paymentIntentId)));
      }
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "sale.completed",
        entityType: "sale",
        entityId: saleId,
        storeId: input.storeId,
        changes: {
          number,
          ...totals,
          itemCount: lines.length,
          paymentMethods: [...new Set(input.payments.map((payment) => payment.method))],
          ...(input.customerId ? { customerId: input.customerId } : {}),
          ...(suspended ? { resumedFromSuspension: true } : {}),
        },
      });
      return { saleId, number, totalCents: totals.totalCents, changeCents, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error, KEY_CONSTRAINT)) {
      // A concurrent retry with the same key committed first: answer with that sale.
      const previous = await withScope(dbScope(context), (tx) => findByKey(tx, orgId, input.completionKey));
      if (previous?.number) return { saleId: previous.id, number: previous.number, totalCents: previous.totalCents, changeCents: previous.changeCents, replayed: true };
    }
    throw error;
  }
}
