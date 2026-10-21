import "server-only";
import { and, asc, count, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { brands, categories, products, productVariants, suppliers } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { diffFields, recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { invalid } from "@/server/errors";
import { likePattern, pageResult, pageWindow } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";
import {
  assertCanManageCatalog,
  assertCanManageCosts,
  canReadCosts,
  currentCostCents,
  currentPriceCents,
  filledFields,
  lockProduct,
  parseOrThrow,
  PRODUCT_NOT_FOUND,
  translateCatalogErrors,
} from "./queries";
import {
  createProductSchema,
  productInputSchema,
  type CreateProductInput,
  type ParsedProductInput,
  type ProductFilters,
  type ProductInput,
} from "./schemas";
import { insertVariant } from "./variants";

export type { CreateProductInput, ProductFilters, ProductInput } from "./schemas";

const PRODUCT_AUDIT_FIELDS = ["name", "description", "unit", "categoryId", "brandId", "supplierId"] as const;
type ReferenceField = "categoryId" | "brandId" | "supplierId";

const REFERENCE_CHECKS = [
  { field: "categoryId", table: categories, message: "Selecione uma categoria ativa da empresa." },
  { field: "brandId", table: brands, message: "Selecione uma marca ativa da empresa." },
  { field: "supplierId", table: suppliers, message: "Selecione um fornecedor ativo da empresa." },
] as const;

/**
 * Newly chosen category/brand/supplier must be an active entry of the
 * organization. Keeping an entry that was deactivated later is allowed.
 */
async function assertReferencesUsable(
  tx: Tx,
  organizationId: string,
  next: Record<ReferenceField, string | null>,
  current?: Record<ReferenceField, string | null>,
) {
  for (const { field, table, message } of REFERENCE_CHECKS) {
    const id = next[field];
    if (!id || id === current?.[field]) continue;
    const [found] = await tx
      .select({ isActive: table.isActive })
      .from(table)
      .where(and(eq(table.organizationId, organizationId), eq(table.id, id)));
    if (!found?.isActive) throw invalid("Revise os campos destacados.", { [field]: [message] });
  }
}

/** `undefined` keeps the current value (or none on creation). */
function productColumns(input: ParsedProductInput, current?: Record<ReferenceField | "unit", string | null>) {
  const keep = <T>(value: T | undefined, fallback: T) => (value === undefined ? fallback : value);
  return {
    name: input.name,
    description: input.description ?? null,
    unit: input.unit ?? (current?.unit as ParsedProductInput["unit"]) ?? "un",
    categoryId: keep(input.categoryId, current?.categoryId ?? null),
    brandId: keep(input.brandId, current?.brandId ?? null),
    supplierId: keep(input.supplierId, current?.supplierId ?? null),
  };
}

/** Products of the organization (the catalog is shared by every store), filtered and paginated. */
export async function listProducts(context: TenantContext, filters: ProductFilters) {
  assertCan(context, "catalog.read");
  const orgId = context.organization.id;
  const conditions: (SQL | undefined)[] = [eq(products.organizationId, orgId)];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    const variantMatch = and(
      eq(productVariants.organizationId, products.organizationId),
      eq(productVariants.productId, products.id),
      or(ilike(productVariants.sku, pattern), ilike(productVariants.barcode, pattern)),
    );
    conditions.push(or(ilike(products.name, pattern), sql`exists (select 1 from ${productVariants} where ${variantMatch})`));
  }
  if (filters.status) conditions.push(eq(products.isActive, filters.status === "active"));
  if (filters.categoryId) conditions.push(eq(products.categoryId, filters.categoryId));
  if (filters.brandId) conditions.push(eq(products.brandId, filters.brandId));
  if (filters.supplierId) conditions.push(eq(products.supplierId, filters.supplierId));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);

  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(products).where(where);
    const rows = await tx
      .select({
        id: products.id,
        name: products.name,
        unit: products.unit,
        isActive: products.isActive,
        categoryName: categories.name,
        brandName: brands.name,
        variantCount: sql<number>`(select count(*) from ${productVariants}
          where ${productVariants.organizationId} = ${products.organizationId} and ${productVariants.productId} = ${products.id})`.mapWith(Number),
      })
      .from(products)
      .leftJoin(categories, and(eq(categories.organizationId, products.organizationId), eq(categories.id, products.categoryId)))
      .leftJoin(brands, and(eq(brands.organizationId, products.organizationId), eq(brands.id, products.brandId)))
      .where(where)
      .orderBy(asc(sql`lower(${products.name})`), asc(products.id))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}

/** Product with its variants and current prices; costs only for members allowed to see them. Null when missing. */
export async function getProduct(context: TenantContext, productId: string) {
  assertCan(context, "catalog.read");
  if (!isUuid(productId)) return null;
  const orgId = context.organization.id;
  const withCosts = canReadCosts(context);
  return withScope(dbScope(context), async (tx) => {
    const [product] = await tx
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        unit: products.unit,
        isActive: products.isActive,
        categoryId: products.categoryId,
        categoryName: categories.name,
        brandId: products.brandId,
        brandName: brands.name,
        supplierId: products.supplierId,
        supplierName: suppliers.name,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .leftJoin(categories, and(eq(categories.organizationId, products.organizationId), eq(categories.id, products.categoryId)))
      .leftJoin(brands, and(eq(brands.organizationId, products.organizationId), eq(brands.id, products.brandId)))
      .leftJoin(suppliers, and(eq(suppliers.organizationId, products.organizationId), eq(suppliers.id, products.supplierId)))
      .where(and(eq(products.organizationId, orgId), eq(products.id, productId)));
    if (!product) return null;
    const variants = await tx
      .select({
        id: productVariants.id,
        name: productVariants.name,
        sku: productVariants.sku,
        barcode: productVariants.barcode,
        isActive: productVariants.isActive,
        priceCents: currentPriceCents,
        ...(withCosts ? { costCents: currentCostCents } : {}),
      })
      .from(productVariants)
      .where(and(eq(productVariants.organizationId, orgId), eq(productVariants.productId, productId)))
      .orderBy(asc(sql`lower(${productVariants.name})`), asc(productVariants.id));
    return { ...product, variants };
  });
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

/** Product, variants and initial prices/costs in one transaction, with audit entries for each. */
export async function createProduct(context: TenantContext, rawInput: CreateProductInput) {
  assertCanManageCatalog(context);
  const input = parseOrThrow(createProductSchema, rawInput);
  if (input.variants.some((variant) => variant.costCents !== undefined)) assertCanManageCosts(context);
  const orgId = context.organization.id;
  const values = productColumns(input);
  try {
    return await withScope(dbScope(context), async (tx) => {
      await assertReferencesUsable(tx, orgId, values);
      const [created] = await tx.insert(products).values({ organizationId: orgId, ...values }).returning({ id: products.id });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "product.created",
        entityType: "product",
        entityId: created.id,
        changes: filledFields(values),
      });
      const variantIds: string[] = [];
      for (const variant of input.variants) variantIds.push((await insertVariant(tx, context, created.id, variant)).id);
      return { id: created.id, variantIds };
    });
  } catch (error) {
    translateCatalogErrors(error);
  }
}

/** Product fields only; variants and prices have their own operations. No change, no audit entry. */
export async function updateProduct(context: TenantContext, productId: string, rawInput: ProductInput) {
  assertCanManageCatalog(context);
  const input = parseOrThrow(productInputSchema, rawInput);
  if (!isUuid(productId)) throw PRODUCT_NOT_FOUND();
  const orgId = context.organization.id;
  try {
    await withScope(dbScope(context), async (tx) => {
      const current = await lockProduct(tx, orgId, productId);
      const next = productColumns(input, current);
      if (next.unit !== current.unit) {
        throw invalid("A unidade não pode ser alterada depois do cadastro.", { unit: ["Unidade definida no cadastro do produto."] });
      }
      const changes = diffFields(current, next, PRODUCT_AUDIT_FIELDS);
      if (Object.keys(changes).length === 0) return;
      await assertReferencesUsable(tx, orgId, next, current);
      await tx
        .update(products)
        .set({ ...next, updatedAt: new Date() })
        .where(and(eq(products.organizationId, orgId), eq(products.id, productId)));
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "product.updated",
        entityType: "product",
        entityId: productId,
        changes,
      });
    });
  } catch (error) {
    translateCatalogErrors(error);
  }
}

/** Products are never deleted (they will own sales history); inactive products leave sale and new entries. */
export async function setProductActive(context: TenantContext, productId: string, isActive: boolean) {
  assertCanManageCatalog(context);
  if (!isUuid(productId)) throw PRODUCT_NOT_FOUND();
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const current = await lockProduct(tx, orgId, productId);
    if (current.isActive === isActive) return;
    await tx
      .update(products)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(products.organizationId, orgId), eq(products.id, productId)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "product.updated",
      entityType: "product",
      entityId: productId,
      changes: { isActive: { from: current.isActive, to: isActive } },
    });
  });
}
