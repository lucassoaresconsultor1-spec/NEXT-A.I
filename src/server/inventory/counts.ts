import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { brands, categories, inventoryBalances, inventoryCountItems, inventoryCounts, inventoryMovements, products, productVariants, stores, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope, can } from "@/server/authz/guard";
import { nextDocumentNumber } from "@/server/counters";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { pageResult, pageWindow } from "@/server/pagination";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import type { z } from "zod";
import { lockBalance, postLedgerEntry } from "./ledger";
import { approveCountSchema, cancelCountSchema, MAX_COUNT_ITEMS, openCountSchema, recordCountSchema, type CountFilters } from "./count-schemas";
import { fromDbQuantity, isWholeQuantity, toDbQuantity } from "./quantity";

// Batch stock counts (m31): open (snapshot of the items, blind counting) ->
// approved (a "count" movement per divergent counted item, against the balance
// at approval, under the balance locks in variant order) or cancelled.
// Uncounted items stay as they are.

const COUNT_NOT_FOUND = () => notFound("Inventário não encontrado.");
const OPEN_CONSTRAINT = "inventory_counts_one_open_per_store";
const ITEM_CHUNK = 1000;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

/** Count visible to the member (store in scope), locked until commit. */
async function lockCount(tx: Tx, context: TenantContext, countId: string, mode: "update" | "share") {
  if (!isUuid(countId)) throw COUNT_NOT_FOUND();
  const orgId = context.organization.id;
  const [row] = await tx
    .select({ id: inventoryCounts.id, number: inventoryCounts.number, storeId: inventoryCounts.storeId, status: inventoryCounts.status })
    .from(inventoryCounts)
    .where(and(eq(inventoryCounts.organizationId, orgId), eq(inventoryCounts.id, countId), storeScopeCondition(context.storeScope, inventoryCounts.storeId)))
    .for(mode);
  if (!row) throw COUNT_NOT_FOUND();
  if (row.status !== "open") throw invalid("Este inventário não está mais em contagem.");
  return row;
}

async function audit(tx: Tx, context: TenantContext, entry: { id: string; number: number; storeId: string }, action: string, changes: Record<string, unknown>) {
  await recordAudit(tx, {
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: `inventory_count.${action}`,
    entityType: "inventory_count",
    entityId: entry.id,
    storeId: entry.storeId,
    changes: { number: entry.number, ...changes },
  });
}

export async function openCount(context: TenantContext, rawInput: unknown): Promise<{ id: string; number: number }> {
  assertCan(context, "inventory.count.manage");
  const input = parse(openCountSchema, rawInput);
  assertStoreInScope(context, input.storeId);
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      await assertFeature(tx, orgId, "inventory");
      const [store] = await tx.select({ status: stores.status }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, input.storeId)));
      if (!store) throw notFound("Loja não encontrada.");
      if (store.status !== "active") throw invalid("Lojas inativas não fazem inventário.");
      if (input.categoryId) {
        const [found] = await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.organizationId, orgId), eq(categories.id, input.categoryId)));
        if (!found) throw invalid("Revise os campos destacados.", { categoryId: ["Categoria não encontrada."] });
      }
      if (input.brandId) {
        const [found] = await tx.select({ id: brands.id }).from(brands).where(and(eq(brands.organizationId, orgId), eq(brands.id, input.brandId)));
        if (!found) throw invalid("Revise os campos destacados.", { brandId: ["Marca não encontrada."] });
      }
      const [open] = await tx
        .select({ id: inventoryCounts.id })
        .from(inventoryCounts)
        .where(and(eq(inventoryCounts.organizationId, orgId), eq(inventoryCounts.storeId, input.storeId), eq(inventoryCounts.status, "open")));
      if (open) throw conflict("Já existe um inventário em contagem nesta loja.");

      // Items: active catalog items of the filter plus anything with stock in the store (inactive leftovers included).
      const conditions: (SQL | undefined)[] = [
        eq(productVariants.organizationId, orgId),
        or(and(eq(productVariants.isActive, true), eq(products.isActive, true)), sql`${inventoryBalances.quantity} > 0`),
        input.categoryId ? eq(products.categoryId, input.categoryId) : undefined,
        input.brandId ? eq(products.brandId, input.brandId) : undefined,
      ];
      const items = await tx
        .select({ variantId: productVariants.id, quantity: sql<string>`coalesce(${inventoryBalances.quantity}, 0)::text` })
        .from(productVariants)
        .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
        .leftJoin(
          inventoryBalances,
          and(eq(inventoryBalances.organizationId, productVariants.organizationId), eq(inventoryBalances.storeId, input.storeId), eq(inventoryBalances.variantId, productVariants.id)),
        )
        .where(and(...conditions))
        .limit(MAX_COUNT_ITEMS + 1);
      if (items.length === 0) throw invalid("Não há itens para contar com estes filtros.");
      if (items.length > MAX_COUNT_ITEMS) throw invalid(`O inventário passaria de ${MAX_COUNT_ITEMS} itens. Filtre por categoria ou marca.`);

      const number = await nextDocumentNumber(tx, orgId, "inventory_count");
      const [created] = await tx
        .insert(inventoryCounts)
        .values({ organizationId: orgId, number, storeId: input.storeId, categoryId: input.categoryId ?? null, brandId: input.brandId ?? null, note: input.note ?? null, openedBy: context.user.id })
        .returning({ id: inventoryCounts.id });
      for (let start = 0; start < items.length; start += ITEM_CHUNK) {
        await tx.insert(inventoryCountItems).values(
          items.slice(start, start + ITEM_CHUNK).map((item) => ({ organizationId: orgId, countId: created.id, variantId: item.variantId, expectedQuantity: toDbQuantity(fromDbQuantity(item.quantity)) })),
        );
      }
      await audit(tx, context, { id: created.id, number, storeId: input.storeId }, "opened", { items: items.length, categoryId: input.categoryId ?? null, brandId: input.brandId ?? null });
      return { id: created.id, number };
    });
  } catch (error) {
    if (isUniqueViolation(error, OPEN_CONSTRAINT)) throw conflict("Já existe um inventário em contagem nesta loja.");
    throw error;
  }
}

export async function recordCountedQuantities(context: TenantContext, countId: string, rawInput: unknown): Promise<void> {
  assertCan(context, "inventory.count.record");
  const input = parse(recordCountSchema, rawInput);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    // Shared lock: counters record in parallel; approval and cancellation wait for them.
    const entry = await lockCount(tx, context, countId, "share");
    const ids = input.items.map((item) => item.itemId);
    const rows = await tx
      .select({ id: inventoryCountItems.id, unit: products.unit })
      .from(inventoryCountItems)
      .innerJoin(productVariants, and(eq(productVariants.organizationId, inventoryCountItems.organizationId), eq(productVariants.id, inventoryCountItems.variantId)))
      .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
      .where(and(eq(inventoryCountItems.organizationId, orgId), eq(inventoryCountItems.countId, entry.id), inArray(inventoryCountItems.id, ids)));
    const units = new Map(rows.map((row) => [row.id, row.unit]));
    const errors: Record<string, string[]> = {};
    input.items.forEach((item, index) => {
      const unit = units.get(item.itemId);
      if (!unit) errors[`items.${index}.itemId`] = ["Item não pertence a este inventário."];
      else if (unit === "un" && !isWholeQuantity(item.countedQuantity)) errors[`items.${index}.countedQuantity`] = ["Somente números inteiros."];
    });
    if (Object.keys(errors).length > 0) throw invalid("Revise os itens destacados.", errors);
    const now = new Date();
    for (const item of input.items) {
      await tx
        .update(inventoryCountItems)
        .set({ countedQuantity: toDbQuantity(item.countedQuantity), countedBy: context.user.id, countedAt: now, updatedAt: now })
        .where(and(eq(inventoryCountItems.organizationId, orgId), eq(inventoryCountItems.id, item.itemId)));
    }
    await audit(tx, context, entry, "recorded", { items: input.items.length });
  });
}

export async function approveCount(context: TenantContext, countId: string, rawInput: unknown): Promise<{ adjusted: number }> {
  assertCan(context, "inventory.count.approve");
  const input = parse(approveCountSchema, rawInput);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const entry = await lockCount(tx, context, countId, "update");
    const items = await tx
      .select({ id: inventoryCountItems.id, variantId: inventoryCountItems.variantId, counted: inventoryCountItems.countedQuantity, sku: productVariants.sku })
      .from(inventoryCountItems)
      .innerJoin(productVariants, and(eq(productVariants.organizationId, inventoryCountItems.organizationId), eq(productVariants.id, inventoryCountItems.variantId)))
      .where(and(eq(inventoryCountItems.organizationId, orgId), eq(inventoryCountItems.countId, entry.id), isNotNull(inventoryCountItems.countedQuantity)))
      .orderBy(asc(inventoryCountItems.variantId));
    const [{ value: total }] = await tx
      .select({ value: count() })
      .from(inventoryCountItems)
      .where(and(eq(inventoryCountItems.organizationId, orgId), eq(inventoryCountItems.countId, entry.id)));
    // Every balance is locked (variant order) and checked against its reservations before any change.
    const divergent: { id: string; variantId: string; counted: bigint }[] = [];
    const errors: Record<string, string[]> = {};
    for (const item of items) {
      const counted = fromDbQuantity(item.counted!);
      const balance = await lockBalance(tx, orgId, entry.storeId, item.variantId);
      if (counted < balance.reserved) errors[`items.${item.id}`] = [`${item.sku}: contado abaixo do reservado (${toDbQuantity(balance.reserved)}).`];
      else if (counted !== balance.quantity) divergent.push({ id: item.id, variantId: item.variantId, counted });
    }
    if (Object.keys(errors).length > 0) throw invalid("Há itens contados abaixo do estoque reservado. Libere as reservas ou refaça a contagem.", errors);
    const reason = `Inventário nº ${entry.number}: ${input.reason}`.slice(0, 240);
    for (const item of divergent) {
      const movement = await postLedgerEntry(tx, context, { storeId: entry.storeId, variantId: item.variantId, type: "count", quantityMilli: item.counted, reason });
      await tx.update(inventoryCountItems).set({ movementId: movement.id, updatedAt: new Date() }).where(and(eq(inventoryCountItems.organizationId, orgId), eq(inventoryCountItems.id, item.id)));
    }
    await tx
      .update(inventoryCounts)
      .set({ status: "approved", approvedBy: context.user.id, approvedAt: new Date(), approvalReason: input.reason, updatedAt: new Date() })
      .where(and(eq(inventoryCounts.organizationId, orgId), eq(inventoryCounts.id, entry.id)));
    await audit(tx, context, entry, "approved", { counted: items.length, adjusted: divergent.length, uncounted: total - items.length, reason: input.reason });
    return { adjusted: divergent.length };
  });
}

export async function cancelCount(context: TenantContext, countId: string, rawInput: unknown): Promise<void> {
  assertCan(context, "inventory.count.manage");
  const input = parse(cancelCountSchema, rawInput);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const entry = await lockCount(tx, context, countId, "update");
    await tx
      .update(inventoryCounts)
      .set({ status: "cancelled", cancelledBy: context.user.id, cancelledAt: new Date(), cancelReason: input.reason, updatedAt: new Date() })
      .where(and(eq(inventoryCounts.organizationId, orgId), eq(inventoryCounts.id, entry.id)));
    await audit(tx, context, entry, "cancelled", { reason: input.reason });
  });
}

function assertCanRead(context: TenantContext) {
  if (!can(context, "inventory.read") && !can(context, "inventory.count.record")) throw forbidden();
}

/** Who may see system balances in a count (the others count blind). */
const seesBalances = (context: TenantContext) => can(context, "inventory.count.manage") || can(context, "inventory.count.approve");

export async function getCount(context: TenantContext, countId: string, options: { blind?: boolean } = {}) {
  assertCanRead(context);
  if (!isUuid(countId)) return null;
  const blind = !seesBalances(context) || (options.blind ?? false);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const [header] = await tx
      .select({
        id: inventoryCounts.id,
        number: inventoryCounts.number,
        status: inventoryCounts.status,
        storeId: inventoryCounts.storeId,
        storeName: stores.name,
        categoryId: inventoryCounts.categoryId,
        brandId: inventoryCounts.brandId,
        note: inventoryCounts.note,
        openedAt: inventoryCounts.openedAt,
        openedByName: users.name,
        approvedAt: inventoryCounts.approvedAt,
        approvalReason: inventoryCounts.approvalReason,
        cancelledAt: inventoryCounts.cancelledAt,
        cancelReason: inventoryCounts.cancelReason,
      })
      .from(inventoryCounts)
      .innerJoin(stores, and(eq(stores.organizationId, inventoryCounts.organizationId), eq(stores.id, inventoryCounts.storeId)))
      .leftJoin(users, eq(users.id, inventoryCounts.openedBy))
      .where(and(eq(inventoryCounts.organizationId, orgId), eq(inventoryCounts.id, countId), storeScopeCondition(context.storeScope, inventoryCounts.storeId)));
    if (!header) return null;
    const rows = await tx
      .select({
        id: inventoryCountItems.id,
        variantId: inventoryCountItems.variantId,
        sku: productVariants.sku,
        productName: products.name,
        variantName: productVariants.name,
        unit: products.unit,
        countedQuantity: inventoryCountItems.countedQuantity,
        countedAt: inventoryCountItems.countedAt,
        expectedQuantity: inventoryCountItems.expectedQuantity,
        currentQuantity: sql<string>`coalesce(${inventoryBalances.quantity}, 0)::text`,
        adjustment: inventoryMovements.quantity,
        // Any other movement of the item in the store between opening and approval (or now).
        movedDuringCount: sql<boolean>`exists (select 1 from ${inventoryMovements} m
          where m.organization_id = ${inventoryCountItems.organizationId} and m.store_id = ${header.storeId}::uuid
            and m.variant_id = ${inventoryCountItems.variantId} and m.created_at > ${inventoryCounts.openedAt}
            and (${inventoryCounts.approvedAt} is null or m.created_at < ${inventoryCounts.approvedAt})
            and m.id is distinct from ${inventoryCountItems.movementId})`,
      })
      .from(inventoryCountItems)
      .innerJoin(inventoryCounts, and(eq(inventoryCounts.organizationId, inventoryCountItems.organizationId), eq(inventoryCounts.id, inventoryCountItems.countId)))
      .innerJoin(productVariants, and(eq(productVariants.organizationId, inventoryCountItems.organizationId), eq(productVariants.id, inventoryCountItems.variantId)))
      .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
      .leftJoin(
        inventoryBalances,
        and(eq(inventoryBalances.organizationId, inventoryCountItems.organizationId), eq(inventoryBalances.storeId, header.storeId), eq(inventoryBalances.variantId, inventoryCountItems.variantId)),
      )
      .leftJoin(inventoryMovements, and(eq(inventoryMovements.organizationId, inventoryCountItems.organizationId), eq(inventoryMovements.id, inventoryCountItems.movementId)))
      .where(and(eq(inventoryCountItems.organizationId, orgId), eq(inventoryCountItems.countId, countId)))
      .orderBy(asc(products.name), asc(productVariants.name));
    const items = rows.map(({ expectedQuantity, currentQuantity, adjustment, movedDuringCount, ...item }) => {
      if (blind) return item;
      const difference = header.status === "open" && item.countedQuantity !== null ? toDbQuantity(fromDbQuantity(item.countedQuantity) - fromDbQuantity(currentQuantity)) : null;
      return { ...item, expectedQuantity, currentQuantity: header.status === "open" ? currentQuantity : null, difference, adjustment, movedDuringCount };
    });
    return { ...header, blind, items };
  });
}

export async function listCounts(context: TenantContext, filters: CountFilters) {
  assertCanRead(context);
  const orgId = context.organization.id;
  const conditions: (SQL | undefined)[] = [eq(inventoryCounts.organizationId, orgId), storeScopeCondition(context.storeScope, inventoryCounts.storeId)];
  if (filters.status) conditions.push(eq(inventoryCounts.status, filters.status));
  if (filters.storeId) conditions.push(eq(inventoryCounts.storeId, filters.storeId));
  if (filters.number) conditions.push(eq(inventoryCounts.number, filters.number));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const [total] = await tx.select({ value: count() }).from(inventoryCounts).where(where);
    const rows = await tx
      .select({
        id: inventoryCounts.id,
        number: inventoryCounts.number,
        status: inventoryCounts.status,
        storeId: inventoryCounts.storeId,
        storeName: stores.name,
        openedAt: inventoryCounts.openedAt,
        itemCount: sql<number>`(select count(*) from ${inventoryCountItems} i
          where i.organization_id = ${inventoryCounts.organizationId} and i.count_id = ${inventoryCounts.id})`.mapWith(Number),
        countedCount: sql<number>`(select count(*) from ${inventoryCountItems} i
          where i.organization_id = ${inventoryCounts.organizationId} and i.count_id = ${inventoryCounts.id} and i.counted_quantity is not null)`.mapWith(Number),
      })
      .from(inventoryCounts)
      .innerJoin(stores, and(eq(stores.organizationId, inventoryCounts.organizationId), eq(stores.id, inventoryCounts.storeId)))
      .where(where)
      .orderBy(desc(inventoryCounts.number))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}
