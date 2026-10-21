import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { inventoryBalances, inventoryMovements, products, productVariants, stores, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { zonedDayStart } from "@/lib/dates";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope } from "@/server/authz/guard";
import { fieldErrorsOf } from "@/server/forms";
import { invalid, notFound } from "@/server/errors";
import { likePattern, pageResult, pageWindow } from "@/server/pagination";
import { assertFeature } from "@/server/plans/entitlements";
import { fromDbQuantity, isWholeQuantity, ledgerEffect, MAX_QUANTITY_MILLI, toDbQuantity, ZERO } from "./quantity";
import { movementInputSchema, type BalanceFilters, type MovementFilters, type MovementInput, type ParsedMovementInput } from "./schemas";

export type { BalanceFilters, MovementFilters, MovementInput } from "./schemas";

// Stock by ledger: a manual movement appends one immutable row to
// inventory_movements and updates inventory_balances in the same transaction,
// under a row lock on the balance. The balance is never written any other way.

const STORE_NOT_FOUND = () => notFound("Loja não encontrada.");
const VARIANT_NOT_FOUND = () => notFound("Produto não encontrado.");

function parseMovement(input: MovementInput): ParsedMovementInput {
  const parsed = movementInputSchema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

async function loadMovementTargets(tx: Tx, context: TenantContext, input: ParsedMovementInput) {
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
async function lockBalance(tx: Tx, organizationId: string, storeId: string, variantId: string) {
  await tx.insert(inventoryBalances).values({ organizationId, storeId, variantId }).onConflictDoNothing();
  const [row] = await tx
    .select({ quantity: inventoryBalances.quantity })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.organizationId, organizationId),
        eq(inventoryBalances.storeId, storeId),
        eq(inventoryBalances.variantId, variantId),
      ),
    )
    .for("update");
  return fromDbQuantity(row.quantity);
}

/**
 * Records an entry, exit, adjustment, loss or physical count. Entries need an
 * active product and variant; the other types also work on inactive items so
 * leftover stock can be written off. Negative balances are refused.
 */
export async function recordMovement(context: TenantContext, rawInput: MovementInput) {
  assertCan(context, "inventory.manage");
  const input = parseMovement(rawInput);
  assertStoreInScope(context, input.storeId);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const variant = await loadMovementTargets(tx, context, input);
    if (input.type === "entry" && !(variant.variantActive && variant.productActive)) {
      throw invalid("Produtos ou variações inativos não recebem entradas.");
    }
    if (variant.unit === "un" && !isWholeQuantity(input.quantityMilli)) {
      throw invalid("Revise os campos destacados.", { quantity: ["Produtos vendidos por unidade aceitam apenas quantidades inteiras."] });
    }
    const current = await lockBalance(tx, orgId, input.storeId, input.variantId);
    const effect = ledgerEffect(input.type, input.quantityMilli, current);
    if (effect.balanceAfter < ZERO) {
      throw invalid("Saldo insuficiente.", { quantity: [`A loja tem ${toDbQuantity(current)} em estoque; o saldo não pode ficar negativo.`] });
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
  });
}

/** Balances of the stores in scope (only items that ever had a movement), paginated. */
export async function listBalances(context: TenantContext, filters: BalanceFilters) {
  assertCan(context, "inventory.read");
  const orgId = context.organization.id;
  const conditions: (SQL | undefined)[] = [
    eq(inventoryBalances.organizationId, orgId),
    storeScopeCondition(context.storeScope, inventoryBalances.storeId),
  ];
  if (filters.storeId) conditions.push(eq(inventoryBalances.storeId, filters.storeId));
  if (filters.variantId) conditions.push(eq(inventoryBalances.variantId, filters.variantId));
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(or(ilike(products.name, pattern), ilike(productVariants.sku, pattern), ilike(productVariants.barcode, pattern)));
  }
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const variantJoin = and(
      eq(productVariants.organizationId, inventoryBalances.organizationId),
      eq(productVariants.id, inventoryBalances.variantId),
    );
    const productJoin = and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId));
    const [total] = await tx
      .select({ value: count() })
      .from(inventoryBalances)
      .innerJoin(productVariants, variantJoin)
      .innerJoin(products, productJoin)
      .where(where);
    const rows = await tx
      .select({
        storeId: inventoryBalances.storeId,
        storeCode: stores.code,
        storeName: stores.name,
        variantId: inventoryBalances.variantId,
        sku: productVariants.sku,
        barcode: productVariants.barcode,
        variantName: productVariants.name,
        productId: products.id,
        productName: products.name,
        unit: products.unit,
        quantity: inventoryBalances.quantity,
        updatedAt: inventoryBalances.updatedAt,
      })
      .from(inventoryBalances)
      .innerJoin(stores, and(eq(stores.organizationId, inventoryBalances.organizationId), eq(stores.id, inventoryBalances.storeId)))
      .innerJoin(productVariants, variantJoin)
      .innerJoin(products, productJoin)
      .where(where)
      .orderBy(asc(sql`lower(${products.name})`), asc(sql`lower(${productVariants.name})`), asc(stores.code))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}

/** Ledger of the stores in scope, newest first. Dates are calendar days in the organization time zone. */
export async function listMovements(context: TenantContext, filters: MovementFilters) {
  assertCan(context, "inventory.read");
  const orgId = context.organization.id;
  const tz = context.organization.timezone;
  const conditions: (SQL | undefined)[] = [
    eq(inventoryMovements.organizationId, orgId),
    storeScopeCondition(context.storeScope, inventoryMovements.storeId),
  ];
  if (filters.storeId) conditions.push(eq(inventoryMovements.storeId, filters.storeId));
  if (filters.variantId) conditions.push(eq(inventoryMovements.variantId, filters.variantId));
  if (filters.type) conditions.push(eq(inventoryMovements.type, filters.type));
  if (filters.from) conditions.push(gte(inventoryMovements.createdAt, zonedDayStart(filters.from, tz)));
  if (filters.to) conditions.push(lt(inventoryMovements.createdAt, zonedDayStart(filters.to, tz, 1)));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const [total] = await tx.select({ value: count() }).from(inventoryMovements).where(where);
    const rows = await tx
      .select({
        id: inventoryMovements.id,
        type: inventoryMovements.type,
        storeId: inventoryMovements.storeId,
        storeName: stores.name,
        variantId: inventoryMovements.variantId,
        sku: productVariants.sku,
        variantName: productVariants.name,
        productName: products.name,
        quantity: inventoryMovements.quantity,
        balanceAfter: inventoryMovements.balanceAfter,
        countedQuantity: inventoryMovements.countedQuantity,
        reason: inventoryMovements.reason,
        createdAt: inventoryMovements.createdAt,
        actorName: users.name,
      })
      .from(inventoryMovements)
      .innerJoin(stores, and(eq(stores.organizationId, inventoryMovements.organizationId), eq(stores.id, inventoryMovements.storeId)))
      .innerJoin(
        productVariants,
        and(eq(productVariants.organizationId, inventoryMovements.organizationId), eq(productVariants.id, inventoryMovements.variantId)),
      )
      .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
      .leftJoin(users, eq(users.id, inventoryMovements.createdBy))
      .where(where)
      .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}
