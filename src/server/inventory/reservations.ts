import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { inventoryBalances, inventoryReservations } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { invalid } from "@/server/errors";
import { lockBalance } from "./ledger";
import { fromDbQuantity, toDbQuantity } from "./quantity";

// Reservations hold stock without moving it (ADR-015): inventory_balances.reserved
// is always the sum of the active reservations of the store and variant. Used
// inside the caller's transaction by transfers and by suspended sales; the
// caller already authorized the operation.

export type ReservationSource = "transfer" | "sale";

function balanceTarget(organizationId: string, storeId: string, variantId: string) {
  return and(
    eq(inventoryBalances.organizationId, organizationId),
    eq(inventoryBalances.storeId, storeId),
    eq(inventoryBalances.variantId, variantId),
  );
}

async function changeReserved(tx: Tx, organizationId: string, storeId: string, variantId: string, deltaMilli: bigint) {
  await tx
    .update(inventoryBalances)
    .set({ reserved: sql`${inventoryBalances.reserved} + ${toDbQuantity(deltaMilli)}::numeric`, updatedAt: new Date() })
    .where(balanceTarget(organizationId, storeId, variantId));
}

/** Locks the balance (creating it at zero), checks available >= quantity, inserts an active reservation and raises reserved. */
export async function reserveStock(
  tx: Tx,
  organizationId: string,
  input: { storeId: string; variantId: string; quantityMilli: bigint; source: ReservationSource; sourceId: string; actorUserId: string },
) {
  const balance = await lockBalance(tx, organizationId, input.storeId, input.variantId);
  const available = balance.quantity - balance.reserved;
  if (available < input.quantityMilli) {
    throw invalid("Saldo disponível insuficiente.", {
      quantity: [`A loja tem ${toDbQuantity(available < BigInt(0) ? BigInt(0) : available)} disponível.`],
    });
  }
  const [reservation] = await tx
    .insert(inventoryReservations)
    .values({
      organizationId,
      storeId: input.storeId,
      variantId: input.variantId,
      quantity: toDbQuantity(input.quantityMilli),
      source: input.source,
      sourceId: input.sourceId,
      createdBy: input.actorUserId,
    })
    .returning({ id: inventoryReservations.id });
  await changeReserved(tx, organizationId, input.storeId, input.variantId, input.quantityMilli);
  return { id: reservation.id };
}

/** Locks an active reservation and its balance row (balance first, the same order as every movement). */
async function lockActive(tx: Tx, organizationId: string, reservationId: string) {
  const [peek] = await tx
    .select({ storeId: inventoryReservations.storeId, variantId: inventoryReservations.variantId })
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.organizationId, organizationId), eq(inventoryReservations.id, reservationId)));
  if (!peek) return null;
  await lockBalance(tx, organizationId, peek.storeId, peek.variantId);
  const [row] = await tx
    .select({ status: inventoryReservations.status, quantity: inventoryReservations.quantity })
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.organizationId, organizationId), eq(inventoryReservations.id, reservationId)))
    .for("update");
  if (row?.status !== "active") return null;
  return { storeId: peek.storeId, variantId: peek.variantId, quantityMilli: fromDbQuantity(row.quantity) };
}

/** active -> released; lowers reserved. Returns false (no-op) when the reservation is not active. */
export async function releaseReservation(tx: Tx, organizationId: string, reservationId: string) {
  const active = await lockActive(tx, organizationId, reservationId);
  if (!active) return false;
  await tx
    .update(inventoryReservations)
    .set({ status: "released", releasedAt: new Date() })
    .where(and(eq(inventoryReservations.organizationId, organizationId), eq(inventoryReservations.id, reservationId)));
  await changeReserved(tx, organizationId, active.storeId, active.variantId, -active.quantityMilli);
  return true;
}

/** active -> consumed; lowers reserved. The caller posts the matching ledger exit in the same transaction. */
export async function consumeReservation(tx: Tx, organizationId: string, reservationId: string) {
  const active = await lockActive(tx, organizationId, reservationId);
  if (!active) throw invalid("A reserva de estoque não está mais ativa.");
  await tx
    .update(inventoryReservations)
    .set({ status: "consumed", consumedAt: new Date() })
    .where(and(eq(inventoryReservations.organizationId, organizationId), eq(inventoryReservations.id, reservationId)));
  await changeReserved(tx, organizationId, active.storeId, active.variantId, -active.quantityMilli);
  return active;
}
