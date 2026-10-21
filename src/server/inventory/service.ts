import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { inventoryBalances, inventoryMovements, products, productVariants, stores, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { zonedDayStart } from "@/lib/dates";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope } from "@/server/authz/guard";
import { fieldErrorsOf } from "@/server/forms";
import { invalid } from "@/server/errors";
import { likePattern, pageResult, pageWindow } from "@/server/pagination";
import { assertFeature } from "@/server/plans/entitlements";
import { postLedgerEntry } from "./ledger";
import { fromDbQuantity, toDbQuantity } from "./quantity";
import { movementInputSchema, type BalanceFilters, type MovementFilters, type MovementInput, type ParsedMovementInput } from "./schemas";

export type { BalanceFilters, MovementFilters, MovementInput } from "./schemas";

// Stock by ledger: movements go through postLedgerEntry (ledger.ts), which
// appends to inventory_movements and updates inventory_balances under a row lock.

function parseMovement(input: MovementInput): ParsedMovementInput {
  const parsed = movementInputSchema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
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
    return postLedgerEntry(tx, context, input);
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
        reserved: inventoryBalances.reserved,
        inTransit: inventoryBalances.inTransit,
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
    // Available = quantity − reserved, computed in thousandths (ADR-015).
    const withAvailable = rows.map((row) => ({ ...row, available: toDbQuantity(fromDbQuantity(row.quantity) - fromDbQuantity(row.reserved)) }));
    return pageResult(withAvailable, total.value, filters.page);
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
