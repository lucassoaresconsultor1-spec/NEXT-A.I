import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { productCosts, productPrices, productVariants, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { forbidden } from "@/server/errors";
import { pageResult, pageWindow } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";
import {
  assertCanManageCatalog,
  assertCanManageCosts,
  canReadCosts,
  currentCostCents,
  currentPriceCents,
  lockVariant,
  parseOrThrow,
  VARIANT_NOT_FOUND,
} from "./queries";
import { priceInputSchema } from "./schemas";

// Price and cost history: every change appends a row; the latest row is the
// current value. Changing to the current value is a no-op.

async function currentValues(tx: Tx, organizationId: string, variantId: string) {
  const [row] = await tx
    .select({ priceCents: currentPriceCents, costCents: currentCostCents })
    .from(productVariants)
    .where(and(eq(productVariants.organizationId, organizationId), eq(productVariants.id, variantId)));
  return row;
}

export async function setVariantPrice(context: TenantContext, variantId: string, cents: number) {
  assertCanManageCatalog(context);
  const input = parseOrThrow(priceInputSchema, { cents });
  if (!isUuid(variantId)) throw VARIANT_NOT_FOUND();
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    // The variant lock serializes changes, so valid_from follows the order of the changes.
    await lockVariant(tx, orgId, variantId);
    const { priceCents } = await currentValues(tx, orgId, variantId);
    if (priceCents === input.cents) return { changed: false };
    await tx.insert(productPrices).values({ organizationId: orgId, variantId, priceCents: input.cents, createdBy: context.user.id });
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "product_variant.price_changed",
      entityType: "product_variant",
      entityId: variantId,
      changes: { priceCents: { from: priceCents, to: input.cents } },
    });
    return { changed: true };
  });
}

/**
 * Appends a cost record when it differs from the current one, under the variant lock, inside the
 * caller's transaction. Cost amounts stay out of the audit trail; the entry points at the cost
 * history row and tells where the cost came from. No permission check: the caller authorized it.
 */
export async function recordCostInTx(
  tx: Tx,
  organizationId: string,
  actorUserId: string,
  variantId: string,
  cents: number,
  source: "manual" | "purchase_receipt",
) {
  await lockVariant(tx, organizationId, variantId);
  const { costCents } = await currentValues(tx, organizationId, variantId);
  if (costCents === cents) return { changed: false };
  const [created] = await tx
    .insert(productCosts)
    .values({ organizationId, variantId, costCents: cents, createdBy: actorUserId })
    .returning({ id: productCosts.id });
  await recordAudit(tx, {
    organizationId,
    actorUserId,
    action: "product_variant.cost_changed",
    entityType: "product_variant",
    entityId: variantId,
    changes: { costRecordId: created.id, source },
  });
  return { changed: true };
}

export async function setVariantCost(context: TenantContext, variantId: string, cents: number) {
  assertCanManageCosts(context);
  const input = parseOrThrow(priceInputSchema, { cents });
  if (!isUuid(variantId)) throw VARIANT_NOT_FOUND();
  return withScope(dbScope(context), (tx) =>
    recordCostInTx(tx, context.organization.id, context.user.id, variantId, input.cents, "manual"),
  );
}

const HISTORY = {
  price: { table: productPrices, cents: productPrices.priceCents },
  cost: { table: productCosts, cents: productCosts.costCents },
} as const;

/** Newest first; null when the variant does not exist in this organization. Costs need catalog.costs.read. */
export async function listVariantHistory(context: TenantContext, variantId: string, kind: keyof typeof HISTORY, page = 1) {
  assertCan(context, "catalog.read");
  if (kind === "cost" && !canReadCosts(context)) throw forbidden("Seu perfil não tem acesso aos custos dos produtos.");
  if (!isUuid(variantId)) return null;
  const orgId = context.organization.id;
  // Both history tables have the same shape; the price table types the shared columns.
  const table = HISTORY[kind].table as typeof productPrices;
  const where = and(eq(table.organizationId, orgId), eq(table.variantId, variantId));
  const { limit, offset } = pageWindow(page);
  return withScope(dbScope(context), async (tx) => {
    const [variant] = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(and(eq(productVariants.organizationId, orgId), eq(productVariants.id, variantId)));
    if (!variant) return null;
    const [total] = await tx.select({ value: count() }).from(table).where(where);
    const rows = await tx
      .select({ id: table.id, cents: HISTORY[kind].cents, validFrom: table.validFrom, createdByName: users.name })
      .from(table)
      .leftJoin(users, eq(users.id, table.createdBy))
      .where(where)
      .orderBy(desc(table.validFrom), desc(table.id))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, page);
  });
}
