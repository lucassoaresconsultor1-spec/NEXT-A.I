import "server-only";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { brands, categories, suppliers } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { isUuid } from "@/server/stores/schemas";

// Select options for product forms. listSuppliers is paginated, so the forms
// read every active entry here (bounded) plus the product's current values.

export interface CatalogOption {
  id: string;
  name: string;
  isActive: boolean;
}

const OPTION_LIMIT = 1000;

type OptionTable = typeof categories | typeof brands | typeof suppliers;

async function optionsOf(tx: Tx, table: OptionTable, organizationId: string, keepId: string | null | undefined) {
  // Category, brand and supplier tables share these columns.
  const source = table as typeof categories;
  const keep = keepId && isUuid(keepId) ? eq(source.id, keepId) : undefined;
  return tx
    .select({ id: source.id, name: source.name, isActive: source.isActive })
    .from(source)
    .where(and(eq(source.organizationId, organizationId), keep ? or(eq(source.isActive, true), keep) : eq(source.isActive, true)))
    .orderBy(asc(sql`lower(${source.name})`), asc(source.id))
    .limit(OPTION_LIMIT);
}

/**
 * Active categories, brands and suppliers for product forms (up to 1000 each, by name),
 * plus the ids in `keep` even if inactive (the product's current values on edit).
 * Needs catalog.read. Ids in `keep` from another organization are ignored.
 */
export async function listCatalogOptions(
  context: TenantContext,
  keep: { categoryId?: string | null; brandId?: string | null; supplierId?: string | null } = {},
): Promise<{ categories: CatalogOption[]; brands: CatalogOption[]; suppliers: CatalogOption[] }> {
  assertCan(context, "catalog.read");
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => ({
    categories: await optionsOf(tx, categories, orgId, keep.categoryId),
    brands: await optionsOf(tx, brands, orgId, keep.brandId),
    suppliers: await optionsOf(tx, suppliers, orgId, keep.supplierId),
  }));
}
