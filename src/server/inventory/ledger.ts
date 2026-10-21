import "server-only";
import { and, eq } from "drizzle-orm";
import { inventoryBalances, inventoryMovements, products, productVariants, stores } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { invalid, notFound } from "@/server/errors";
import { fromDbQuantity, isWholeQuantity, ledgerEffect, MAX_QUANTITY_MILLI, toDbQuantity, ZERO, type MovementType } from "./quantity";

// Stock by ledger: a movement appends one immutable row to inventory_movements
// and updates inventory_balances in the caller's transaction, under a row lock
// on the balance. The balance is never written any other way. Manual movements
// (recordMovement) and goods receipts both post through postLedgerEntry.

const STORE_NOT_FOUND = () => notFound("Loja não encontrada.");
const VARIANT_NOT_FOUND = () => notFound("Produto não encontrado.");

export interface LedgerEntryInput {
  storeId: string;
  variantId: string;
  type: MovementType;
  quantityMilli: bigint;
  reason: string;
  /** Transfer receipts bring back stock that already left another store, even if the item was deactivated meanwhile. */
  allowInactive?: boolean;
}

async function loadMovementTargets(tx: Tx, context: TenantContext, input: LedgerEntryInput) {
  const orgId = context.organization.id;
  const [store] = await tx
    .select({ status: stores.status })
    .from(stores)
    .where(and(eq(stores.organizationId, orgId), eq(stores.id, input.storeId), storeScopeCondition(context.storeScope, stores.id)));
  if (!store) throw STORE_NOT_FOUND();
  if (store.status !== "active") throw invalid("Lojas inativas não recebem movimentações de estoque.");
  const [variant] = await tx
    .select({
      sku: productVariants.sku,
      variantActive: productVariants.isActive,
      productActive: products.isActive,
      unit: products.unit,
    })
    .from(productVariants)
    .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
    .where(and(eq(productVariants.organizationId, orgId), eq(productVariants.id, input.variantId)));
  if (!variant) throw VARIANT_NOT_FOUND();
  return variant;
}

/** Locks (creating at zero when missing) the balance row of the store and variant. */
export async function lockBalance(tx: Tx, organizationId: string, storeId: string, variantId: string) {
  await tx.insert(inventoryBalances).values({ organizationId, storeId, variantId }).onConflictDoNothing();
  const [row] = await tx
    .select({ quantity: inventoryBalances.quantity, reserved: inventoryBalances.reserved, inTransit: inventoryBalances.inTransit })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.organizationId, organizationId),
        eq(inventoryBalances.storeId, storeId),
        eq(inventoryBalances.variantId, variantId),
      ),
    )
    .for("update");
  return { quantity: fromDbQuantity(row.quantity), reserved: fromDbQuantity(row.reserved), inTransit: fromDbQuantity(row.inTransit) };
}

/**
 * Posts an entry, exit, adjustment, loss or physical count inside the caller's
 * transaction. Entries need an active product and variant; the other types also
 * work on inactive items so leftover stock can be written off. The store must be
 * active and in the member's scope; negative balances are refused. Audited as
 * inventory.movement_recorded. Permission and plan checks are the caller's.
 */
export async function postLedgerEntry(tx: Tx, context: TenantContext, input: LedgerEntryInput) {
  const orgId = context.organization.id;
  const variant = await loadMovementTargets(tx, context, input);
  if (input.type === "entry" && !input.allowInactive && !(variant.variantActive && variant.productActive)) {
    throw invalid("Produtos ou variações inativos não recebem entradas.");
  }
  if (variant.unit === "un" && !isWholeQuantity(input.quantityMilli)) {
    throw invalid("Revise os campos destacados.", { quantity: ["Produtos vendidos por unidade aceitam apenas quantidades inteiras."] });
  }
  const { quantity: current, reserved } = await lockBalance(tx, orgId, input.storeId, input.variantId);
  const effect = ledgerEffect(input.type, input.quantityMilli, current);
  if (effect.balanceAfter < ZERO) {
    throw invalid("Saldo insuficiente.", { quantity: [`A loja tem ${toDbQuantity(current)} em estoque; o saldo não pode ficar negativo.`] });
  }
  // Reserved stock (transfers, suspended sales) cannot be moved out by other movements (ADR-015).
  if (effect.balanceAfter < reserved) {
    throw invalid("Saldo insuficiente.", {
      quantity: [`A loja tem ${toDbQuantity(reserved)} reservado; o saldo não pode ficar abaixo disso.`],
    });
  }
  if (effect.balanceAfter > MAX_QUANTITY_MILLI) throw invalid("Revise os campos destacados.", { quantity: ["Saldo acima do permitido."] });

  const quantity = toDbQuantity(effect.delta);
  const balanceAfter = toDbQuantity(effect.balanceAfter);
  const countedQuantity = effect.counted === null ? null : toDbQuantity(effect.counted);
  await tx
    .update(inventoryBalances)
    .set({ quantity: balanceAfter, updatedAt: new Date() })
    .where(
      and(
        eq(inventoryBalances.organizationId, orgId),
        eq(inventoryBalances.storeId, input.storeId),
        eq(inventoryBalances.variantId, input.variantId),
      ),
    );
  const [movement] = await tx
    .insert(inventoryMovements)
    .values({
      organizationId: orgId,
      storeId: input.storeId,
      variantId: input.variantId,
      type: input.type,
      quantity,
      balanceAfter,
      countedQuantity,
      reason: input.reason,
      createdBy: context.user.id,
    })
    .returning({ id: inventoryMovements.id, createdAt: inventoryMovements.createdAt });
  await recordAudit(tx, {
    organizationId: orgId,
    actorUserId: context.user.id,
    action: "inventory.movement_recorded",
    entityType: "inventory_movement",
    entityId: movement.id,
    storeId: input.storeId,
    changes: {
      type: input.type,
      variantId: input.variantId,
      sku: variant.sku,
      quantity,
      balanceAfter,
      ...(countedQuantity === null ? {} : { countedQuantity }),
      reason: input.reason,
    },
  });
  return { id: movement.id, quantity, balanceAfter, createdAt: movement.createdAt };
}
