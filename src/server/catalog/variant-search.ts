import "server-only";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { onlyDigits } from "@/lib/documents";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { likePattern } from "@/server/pagination";
import { canReadCosts, currentCostCents } from "./queries";

// Variant lookup for forms (purchase orders, transfers, POS): exact barcode,
// exact SKU or a name match, active items first. Costs only for members who
// may see them.

export const VARIANT_SEARCH_LIMIT = 20;

export interface VariantHit {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  barcode: string | null;
  unit: "un" | "kg" | "l" | "m";
  isActive: boolean;
  costCents?: number | null;
}

export async function searchVariants(context: TenantContext, q: string, options: { activeOnly?: boolean } = {}): Promise<VariantHit[]> {
  assertCan(context, "catalog.read");
  const term = typeof q === "string" ? q.trim().slice(0, 80) : "";
  if (term.length < 2) return [];
  const orgId = context.organization.id;
  const digits = onlyDigits(term);
  const pattern = likePattern(term);
  const matches = or(
    digits.length >= 8 && digits === term ? eq(productVariants.barcode, digits) : undefined,
    eq(productVariants.sku, term.toUpperCase()),
    ilike(products.name, pattern),
    ilike(productVariants.name, pattern),
  );
  const active = and(eq(productVariants.isActive, true), eq(products.isActive, true));
  const withCosts = canReadCosts(context);
  const rows = await withScope(dbScope(context), (tx) =>
    tx
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        variantName: productVariants.name,
        sku: productVariants.sku,
        barcode: productVariants.barcode,
        unit: products.unit,
        isActive: sql<boolean>`(${productVariants.isActive} and ${products.isActive})`,
        ...(withCosts ? { costCents: currentCostCents } : {}),
      })
      .from(productVariants)
      .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
      .where(and(eq(productVariants.organizationId, orgId), matches, options.activeOnly ? active : undefined))
      .orderBy(
        desc(sql`(${productVariants.isActive} and ${products.isActive})`),
        asc(sql`lower(${products.name})`),
        asc(sql`lower(${productVariants.name})`),
        asc(productVariants.id),
      )
      .limit(VARIANT_SEARCH_LIMIT),
  );
  return rows;
}
