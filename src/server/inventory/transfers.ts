import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { inventoryBalances, products, productVariants, stockTransferItems, stockTransfers, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, isStoreInScope, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope, can } from "@/server/authz/guard";
import { nextDocumentNumber } from "@/server/counters";
import { forbidden, invalid, isDomainError, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import type { z } from "zod";
import { lockBalance, postLedgerEntry } from "./ledger";
import { fromDbQuantity, isWholeQuantity, toDbQuantity, ZERO } from "./quantity";
import { consumeReservation, releaseReservation, reserveStock } from "./reservations";
import { cancelTransferSchema, dispatchSchema, receiveSchema, transferRequestSchema, type TransferStatus } from "./transfer-schemas";

// Stock transfers between stores (ADR-015): requested -> approved (stock reserved
// at the origin) -> in transit (exit at the origin, in-transit at the
// destination) -> received (entry at the destination), or cancelled. Each step
// runs in one transaction under a lock on the transfer and on the balance rows,
// always taken in (store, variant) order.

const TRANSFER_NOT_FOUND = () => notFound("Transferência não encontrada.");
const STATUS_TEXT: Record<TransferStatus, string> = {
  requested: "solicitada",
  approved: "aprovada",
  in_transit: "em trânsito",
  received: "recebida",
  cancelled: "cancelada",
};

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

/** Transfer visible to the member (origin or destination in scope), locked until commit, with its items. */
async function lockTransfer(tx: Tx, context: TenantContext, transferId: string) {
  if (!isUuid(transferId)) throw TRANSFER_NOT_FOUND();
  const orgId = context.organization.id;
  const [transfer] = await tx
    .select({
      id: stockTransfers.id,
      number: stockTransfers.number,
      status: stockTransfers.status,
      originStoreId: stockTransfers.originStoreId,
      destinationStoreId: stockTransfers.destinationStoreId,
    })
    .from(stockTransfers)
    .where(and(eq(stockTransfers.organizationId, orgId), eq(stockTransfers.id, transferId)))
    .for("update");
  const scope = context.storeScope;
  if (!transfer || !(isStoreInScope(scope, transfer.originStoreId) || isStoreInScope(scope, transfer.destinationStoreId))) {
    throw TRANSFER_NOT_FOUND();
  }
  const items = await tx
    .select({
      id: stockTransferItems.id,
      variantId: stockTransferItems.variantId,
      requested: stockTransferItems.quantityRequested,
      sent: stockTransferItems.quantitySent,
      reservationId: stockTransferItems.reservationId,
    })
    .from(stockTransferItems)
    .where(and(eq(stockTransferItems.organizationId, orgId), eq(stockTransferItems.transferId, transferId)))
    .for("update");
  items.sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
  return { ...transfer, items };
}

type LockedTransfer = Awaited<ReturnType<typeof lockTransfer>>;

function expectStatus(transfer: LockedTransfer, status: TransferStatus) {
  if (transfer.status !== status) throw invalid(`Esta transferência não está ${STATUS_TEXT[status]}.`);
}

/** The side of the transfer the action belongs to must be in scope; seeing only the other side answers forbidden. */
function assertSide(context: TenantContext, storeId: string) {
  if (!isStoreInScope(context.storeScope, storeId)) throw forbidden("Esta etapa é feita pela outra loja da transferência.");
}

/** Locks every balance row the step touches, in (store, variant) order, before any change. */
async function lockBalancesInOrder(tx: Tx, organizationId: string, keys: { storeId: string; variantId: string }[]) {
  const sorted = [...keys].sort((a, b) => `${a.storeId}|${a.variantId}`.localeCompare(`${b.storeId}|${b.variantId}`));
  for (const key of sorted) await lockBalance(tx, organizationId, key.storeId, key.variantId);
}

async function setInTransit(tx: Tx, organizationId: string, storeId: string, variantId: string, value: bigint) {
  await tx
    .update(inventoryBalances)
    .set({ inTransit: toDbQuantity(value), updatedAt: new Date() })
    .where(and(eq(inventoryBalances.organizationId, organizationId), eq(inventoryBalances.storeId, storeId), eq(inventoryBalances.variantId, variantId)));
}

async function audit(tx: Tx, context: TenantContext, transfer: { id: string; number: number }, action: string, storeId: string, changes: Record<string, unknown>) {
  await recordAudit(tx, {
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: `stock_transfer.${action}`,
    entityType: "stock_transfer",
    entityId: transfer.id,
    storeId,
    changes: { number: transfer.number, ...changes },
  });
}

export async function requestTransfer(context: TenantContext, rawInput: unknown) {
  assertCan(context, "inventory.transfer.request");
  const input = parse(transferRequestSchema, rawInput);
  assertStoreInScope(context, input.destinationStoreId);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const found = await tx
      .select({ id: stores.id, status: stores.status })
      .from(stores)
      .where(and(eq(stores.organizationId, orgId), inArray(stores.id, [input.originStoreId, input.destinationStoreId])));
    const status = new Map(found.map((store) => [store.id, store.status]));
    if (status.get(input.originStoreId) !== "active") throw invalid("Revise os campos destacados.", { originStoreId: ["Selecione uma loja ativa da empresa."] });
    if (status.get(input.destinationStoreId) !== "active") throw invalid("Revise os campos destacados.", { destinationStoreId: ["Selecione uma loja ativa do seu acesso."] });
    const variants = await tx
      .select({ id: productVariants.id, unit: products.unit, variantActive: productVariants.isActive, productActive: products.isActive })
      .from(productVariants)
      .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
      .where(and(eq(productVariants.organizationId, orgId), inArray(productVariants.id, input.items.map((item) => item.variantId))));
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    const errors: Record<string, string[]> = {};
    input.items.forEach((item, index) => {
      const variant = byId.get(item.variantId);
      if (!variant?.variantActive || !variant.productActive) errors[`items.${index}.variantId`] = ["Selecione um produto ativo da empresa."];
      else if (variant.unit === "un" && !isWholeQuantity(item.quantity)) errors[`items.${index}.quantity`] = ["Somente números inteiros."];
    });
    if (Object.keys(errors).length > 0) throw invalid("Revise os campos destacados.", errors);
    const number = await nextDocumentNumber(tx, orgId, "stock_transfer");
    const [transfer] = await tx
      .insert(stockTransfers)
      .values({ organizationId: orgId, number, originStoreId: input.originStoreId, destinationStoreId: input.destinationStoreId, notes: input.notes ?? null, requestedBy: context.user.id })
      .returning({ id: stockTransfers.id });
    await tx
      .insert(stockTransferItems)
      .values(input.items.map((item) => ({ organizationId: orgId, transferId: transfer.id, variantId: item.variantId, quantityRequested: toDbQuantity(item.quantity) })));
    await audit(tx, context, { id: transfer.id, number }, "requested", input.originStoreId, {
      destinationStoreId: input.destinationStoreId,
      items: input.items.map((item) => ({ variantId: item.variantId, quantity: toDbQuantity(item.quantity) })),
    });
    return { id: transfer.id, number };
  });
}

export async function approveTransfer(context: TenantContext, transferId: string) {
  assertCan(context, "inventory.transfer.approve");
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const transfer = await lockTransfer(tx, context, transferId);
    assertSide(context, transfer.originStoreId);
    expectStatus(transfer, "requested");
    for (const [index, item] of transfer.items.entries()) {
      try {
        const reservation = await reserveStock(tx, orgId, {
          storeId: transfer.originStoreId,
          variantId: item.variantId,
          quantityMilli: fromDbQuantity(item.requested),
          source: "transfer",
          sourceId: transfer.id,
          actorUserId: context.user.id,
        });
        await tx.update(stockTransferItems).set({ reservationId: reservation.id, updatedAt: new Date() }).where(and(eq(stockTransferItems.organizationId, orgId), eq(stockTransferItems.id, item.id)));
      } catch (error) {
        if (isDomainError(error) && error.fieldErrors?.quantity) {
          throw invalid("Saldo disponível insuficiente na origem.", { [`items.${index}.quantity`]: error.fieldErrors.quantity });
        }
        throw error;
      }
    }
    await tx.update(stockTransfers).set({ status: "approved", approvedBy: context.user.id, approvedAt: new Date(), updatedAt: new Date() }).where(and(eq(stockTransfers.organizationId, orgId), eq(stockTransfers.id, transfer.id)));
    await audit(tx, context, transfer, "approved", transfer.originStoreId, { status: { from: "requested", to: "approved" } });
  });
}

export async function dispatchTransfer(context: TenantContext, transferId: string, rawInput: unknown) {
  assertCan(context, "inventory.transfer.execute");
  const input = parse(dispatchSchema, rawInput);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const transfer = await lockTransfer(tx, context, transferId);
    assertSide(context, transfer.originStoreId);
    expectStatus(transfer, "approved");
    const sentById = new Map(input.items.map((line) => [line.itemId, line.quantitySent]));
    const errors: Record<string, string[]> = {};
    for (const [index, line] of input.items.entries()) {
      const item = transfer.items.find((entry) => entry.id === line.itemId);
      if (!item) errors[`items.${index}.itemId`] = ["Item não pertence a esta transferência."];
      else if (line.quantitySent > fromDbQuantity(item.requested)) errors[`items.${index}.quantitySent`] = ["Quantidade acima da solicitada."];
    }
    if (Object.keys(errors).length > 0) throw invalid("Revise os campos destacados.", errors);
    const plan = transfer.items.map((item) => ({ item, sent: sentById.get(item.id) ?? fromDbQuantity(item.requested) }));
    if (plan.every((entry) => entry.sent === ZERO)) {
      throw invalid("Informe ao menos um item enviado; para não enviar nada, cancele a transferência.");
    }
    await lockBalancesInOrder(tx, orgId, transfer.items.flatMap((item) => [
      { storeId: transfer.originStoreId, variantId: item.variantId },
      { storeId: transfer.destinationStoreId, variantId: item.variantId },
    ]));
    const destination = await tx.select({ name: stores.name }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, transfer.destinationStoreId)));
    for (const { item, sent } of plan) {
      if (item.reservationId) await consumeReservation(tx, orgId, item.reservationId);
      let exitMovementId: string | null = null;
      if (sent > ZERO) {
        const movement = await postLedgerEntry(tx, context, {
          storeId: transfer.originStoreId,
          variantId: item.variantId,
          type: "exit",
          quantityMilli: sent,
          reason: `Transferência nº ${transfer.number} para ${destination[0]?.name ?? "outra loja"}`,
        });
        exitMovementId = movement.id;
        const target = await lockBalance(tx, orgId, transfer.destinationStoreId, item.variantId);
        await setInTransit(tx, orgId, transfer.destinationStoreId, item.variantId, target.inTransit + sent);
      }
      await tx.update(stockTransferItems).set({ quantitySent: toDbQuantity(sent), exitMovementId, updatedAt: new Date() }).where(and(eq(stockTransferItems.organizationId, orgId), eq(stockTransferItems.id, item.id)));
    }
    await tx.update(stockTransfers).set({ status: "in_transit", dispatchedBy: context.user.id, dispatchedAt: new Date(), updatedAt: new Date() }).where(and(eq(stockTransfers.organizationId, orgId), eq(stockTransfers.id, transfer.id)));
    await audit(tx, context, transfer, "dispatched", transfer.originStoreId, {
      status: { from: "approved", to: "in_transit" },
      items: plan.map(({ item, sent }) => ({ variantId: item.variantId, requested: item.requested, sent: toDbQuantity(sent) })),
    });
  });
}

export async function receiveTransfer(context: TenantContext, transferId: string, rawInput: unknown) {
  assertCan(context, "inventory.transfer.execute");
  const input = parse(receiveSchema, rawInput);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const transfer = await lockTransfer(tx, context, transferId);
    assertSide(context, transfer.destinationStoreId);
    expectStatus(transfer, "in_transit");
    const receivedById = new Map(input.items.map((line) => [line.itemId, line.quantityReceived]));
    const errors: Record<string, string[]> = {};
    for (const [index, line] of input.items.entries()) {
      const item = transfer.items.find((entry) => entry.id === line.itemId);
      if (!item) errors[`items.${index}.itemId`] = ["Item não pertence a esta transferência."];
      else if (line.quantityReceived > fromDbQuantity(item.sent ?? "0")) errors[`items.${index}.quantityReceived`] = ["Quantidade acima da enviada."];
    }
    if (Object.keys(errors).length > 0) throw invalid("Revise os campos destacados.", errors);
    const plan = transfer.items.map((item) => {
      const sent = fromDbQuantity(item.sent ?? "0");
      return { item, sent, received: receivedById.get(item.id) ?? sent };
    });
    const divergent = plan.some((entry) => entry.received < entry.sent);
    if (divergent && !input.divergenceReason) {
      throw invalid("Revise os campos destacados.", { divergenceReason: ["Explique a diferença entre o enviado e o recebido."] });
    }
    await lockBalancesInOrder(tx, orgId, transfer.items.map((item) => ({ storeId: transfer.destinationStoreId, variantId: item.variantId })));
    const origin = await tx.select({ name: stores.name }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, transfer.originStoreId)));
    for (const { item, sent, received } of plan) {
      let entryMovementId: string | null = null;
      if (sent > ZERO) {
        const target = await lockBalance(tx, orgId, transfer.destinationStoreId, item.variantId);
        await setInTransit(tx, orgId, transfer.destinationStoreId, item.variantId, target.inTransit - sent);
      }
      if (received > ZERO) {
        const movement = await postLedgerEntry(tx, context, {
          storeId: transfer.destinationStoreId,
          variantId: item.variantId,
          type: "entry",
          quantityMilli: received,
          reason: `Transferência nº ${transfer.number} de ${origin[0]?.name ?? "outra loja"}`,
          allowInactive: true,
        });
        entryMovementId = movement.id;
      }
      await tx
        .update(stockTransferItems)
        .set({ quantityReceived: toDbQuantity(received), divergenceReason: received < sent ? input.divergenceReason : null, entryMovementId, updatedAt: new Date() })
        .where(and(eq(stockTransferItems.organizationId, orgId), eq(stockTransferItems.id, item.id)));
    }
    await tx.update(stockTransfers).set({ status: "received", receivedBy: context.user.id, receivedAt: new Date(), updatedAt: new Date() }).where(and(eq(stockTransfers.organizationId, orgId), eq(stockTransfers.id, transfer.id)));
    await audit(tx, context, transfer, "received", transfer.destinationStoreId, {
      status: { from: "in_transit", to: "received" },
      items: plan.map(({ item, sent, received }) => ({ variantId: item.variantId, sent: toDbQuantity(sent), received: toDbQuantity(received) })),
      ...(divergent ? { divergenceReason: input.divergenceReason } : {}),
    });
  });
}

export async function cancelTransfer(context: TenantContext, transferId: string, reason: unknown) {
  const { reason: text } = parse(cancelTransferSchema, { reason });
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const transfer = await lockTransfer(tx, context, transferId);
    if (transfer.status !== "requested" && transfer.status !== "approved") throw invalid("Só transferências solicitadas ou aprovadas podem ser canceladas.");
    const byOrigin = can(context, "inventory.transfer.approve") && isStoreInScope(context.storeScope, transfer.originStoreId);
    const byRequester = transfer.status === "requested" && can(context, "inventory.transfer.request") && isStoreInScope(context.storeScope, transfer.destinationStoreId);
    if (!byOrigin && !byRequester) throw forbidden();
    for (const item of transfer.items) if (item.reservationId) await releaseReservation(tx, orgId, item.reservationId);
    await tx
      .update(stockTransfers)
      .set({ status: "cancelled", cancelledBy: context.user.id, cancelledAt: new Date(), cancelReason: text, updatedAt: new Date() })
      .where(and(eq(stockTransfers.organizationId, orgId), eq(stockTransfers.id, transfer.id)));
    await audit(tx, context, transfer, "cancelled", transfer.originStoreId, { status: { from: transfer.status, to: "cancelled" }, reason: text });
  });
}
