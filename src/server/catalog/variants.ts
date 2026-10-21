import "server-only";
import { and, count, eq } from "drizzle-orm";
import type { z } from "zod";
import { productCosts, productPrices, productVariants } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { diffFields, recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { invalid } from "@/server/errors";
import { isUuid } from "@/server/stores/schemas";
import {
  assertCanManageCatalog,
  assertCanManageCosts,
  lockProduct,
  lockVariant,
  parseOrThrow,
  PRODUCT_NOT_FOUND,
  translateCatalogErrors,
  VARIANT_NOT_FOUND,
} from "./queries";
import { MAX_VARIANTS_PER_PRODUCT, newVariantSchema, variantInputSchema, type NewVariantInput, type VariantInput } from "./schemas";

export type { NewVariantInput, VariantInput } from "./schemas";

const VARIANT_AUDIT_FIELDS = ["name", "sku", "barcode"] as const;

/**
 * Inserts a variant with its initial price/cost rows inside the caller's
 * transaction. Cost amounts stay out of the audit trail (audit readers may
 * lack catalog.costs.read); the entry points at the cost history row instead.
 */
export async function insertVariant(tx: Tx, context: TenantContext, productId: string, variant: z.output<typeof newVariantSchema>) {
  const orgId = context.organization.id;
  const [created] = await tx
    .insert(productVariants)
    .values({ organizationId: orgId, productId, name: variant.name, sku: variant.sku, barcode: variant.barcode ?? null })
    .returning({ id: productVariants.id });
  if (variant.priceCents !== undefined) {
    await tx.insert(productPrices).values({ organizationId: orgId, variantId: created.id, priceCents: variant.priceCents, createdBy: context.user.id });
  }
  let costRecordId: string | undefined;
  if (variant.costCents !== undefined) {
    const [cost] = await tx
      .insert(productCosts)
      .values({ organizationId: orgId, variantId: created.id, costCents: variant.costCents, createdBy: context.user.id })
      .returning({ id: productCosts.id });
    costRecordId = cost.id;
  }
  await recordAudit(tx, {
    organizationId: orgId,
    actorUserId: context.user.id,
    action: "product_variant.created",
    entityType: "product_variant",
    entityId: created.id,
    changes: {
      productId,
      name: variant.name,
      sku: variant.sku,
      ...(variant.barcode ? { barcode: variant.barcode } : {}),
      ...(variant.priceCents !== undefined ? { priceCents: variant.priceCents } : {}),
      ...(costRecordId ? { costRecordId } : {}),
    },
  });
  return created;
}

export async function addVariant(context: TenantContext, productId: string, rawInput: NewVariantInput) {
  assertCanManageCatalog(context);
  const input = parseOrThrow(newVariantSchema, rawInput);
  if (input.costCents !== undefined) assertCanManageCosts(context);
  if (!isUuid(productId)) throw PRODUCT_NOT_FOUND();
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      // The product lock serializes concurrent additions, so the limit holds.
      await lockProduct(tx, orgId, productId);
      const [existing] = await tx
        .select({ value: count() })
        .from(productVariants)
        .where(and(eq(productVariants.organizationId, orgId), eq(productVariants.productId, productId)));
      if (existing.value >= MAX_VARIANTS_PER_PRODUCT) {
        throw invalid(`Um produto pode ter no máximo ${MAX_VARIANTS_PER_PRODUCT} variações.`);
      }
      return insertVariant(tx, context, productId, input);
    });
  } catch (error) {
    translateCatalogErrors(error);
  }
}

/** Name, SKU and barcode; prices and costs have their own history. No change, no audit entry. */
export async function updateVariant(context: TenantContext, variantId: string, rawInput: VariantInput) {
  assertCanManageCatalog(context);
  const input = parseOrThrow(variantInputSchema, rawInput);
  if (!isUuid(variantId)) throw VARIANT_NOT_FOUND();
  const orgId = context.organization.id;
  const next = { name: input.name, sku: input.sku, barcode: input.barcode ?? null };
  try {
    await withScope(dbScope(context), async (tx) => {
      const current = await lockVariant(tx, orgId, variantId);
      const changes = diffFields(current, next, VARIANT_AUDIT_FIELDS);
      if (Object.keys(changes).length === 0) return;
      await tx
        .update(productVariants)
        .set({ ...next, updatedAt: new Date() })
        .where(and(eq(productVariants.organizationId, orgId), eq(productVariants.id, variantId)));
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "product_variant.updated",
        entityType: "product_variant",
        entityId: variantId,
        changes,
      });
    });
  } catch (error) {
    translateCatalogErrors(error);
  }
}

/** Variants are never deleted (stock ledger and future sales point at them). */
export async function setVariantActive(context: TenantContext, variantId: string, isActive: boolean) {
  assertCanManageCatalog(context);
  if (!isUuid(variantId)) throw VARIANT_NOT_FOUND();
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const current = await lockVariant(tx, orgId, variantId);
    if (current.isActive === isActive) return;
    await tx
      .update(productVariants)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(productVariants.organizationId, orgId), eq(productVariants.id, variantId)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "product_variant.updated",
      entityType: "product_variant",
      entityId: variantId,
      changes: { isActive: { from: current.isActive, to: isActive } },
    });
  });
}
