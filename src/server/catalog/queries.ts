import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { productCosts, productPrices, products, productVariants } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import type { TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide, can } from "@/server/authz/guard";
import { conflict, forbidden, invalid, isForeignKeyViolation, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";

// Building blocks shared by the catalog services: guards, parsing, current
// price/cost expressions, row locks and friendly errors for constraint races.

export const PRODUCT_NOT_FOUND = () => notFound("Produto não encontrado.");
export const VARIANT_NOT_FOUND = () => notFound("Variação não encontrada.");

/** Catalog changes affect every store, so they need organization-wide access. */
export function assertCanManageCatalog(context: TenantContext) {
  assertCan(context, "catalog.manage");
  assertOrganizationWide(context);
}

export const canReadCosts = (context: TenantContext) => can(context, "catalog.costs.read");

export function assertCanManageCosts(context: TenantContext) {
  assertCanManageCatalog(context);
  if (!canReadCosts(context)) throw forbidden("Seu perfil não tem acesso aos custos dos produtos.");
}

/** Re-validates input inside the service so callers other than a form get the same rules. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

const VARIANT_CONFLICTS: Record<string, () => Error> = {
  product_variants_org_sku_key: () => conflict("Já existe uma variação com este SKU.", { sku: ["SKU já utilizado nesta empresa."] }),
  product_variants_org_barcode_idx: () =>
    conflict("Já existe uma variação com este código de barras.", { barcode: ["Código de barras já utilizado nesta empresa."] }),
  product_variants_product_name_idx: () =>
    conflict("Este produto já tem uma variação com este nome.", { name: ["Nome de variação já utilizado neste produto."] }),
};

const REFERENCE_ERRORS: Record<string, () => Error> = {
  products_category_fk: () => invalid("Categoria inválida.", { categoryId: ["Selecione uma categoria da empresa."] }),
  products_brand_fk: () => invalid("Marca inválida.", { brandId: ["Selecione uma marca da empresa."] }),
  products_supplier_fk: () => invalid("Fornecedor inválido.", { supplierId: ["Selecione um fornecedor da empresa."] }),
};

export function translateCatalogErrors(error: unknown): never {
  for (const [constraint, build] of Object.entries(VARIANT_CONFLICTS)) {
    if (isUniqueViolation(error, constraint)) throw build();
  }
  for (const [constraint, build] of Object.entries(REFERENCE_ERRORS)) {
    if (isForeignKeyViolation(error, constraint)) throw build();
  }
  throw error;
}

/** Most recent price of the variant row in scope, or null when none was set. */
export const currentPriceCents = sql<number | null>`(
  select ${productPrices.priceCents} from ${productPrices}
  where ${productPrices.organizationId} = ${sql.raw('"product_variants"."organization_id"')} and ${productPrices.variantId} = ${sql.raw('"product_variants"."id"')}
  order by ${productPrices.validFrom} desc limit 1)`.mapWith(Number);

export const currentCostCents = sql<number | null>`(
  select ${productCosts.costCents} from ${productCosts}
  where ${productCosts.organizationId} = ${sql.raw('"product_variants"."organization_id"')} and ${productCosts.variantId} = ${sql.raw('"product_variants"."id"')}
  order by ${productCosts.validFrom} desc limit 1)`.mapWith(Number);

/** Locks a variant (and reads its product) for the rest of the transaction. */
export async function lockVariant(tx: Tx, organizationId: string, variantId: string) {
  const [row] = await tx
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      name: productVariants.name,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      isActive: productVariants.isActive,
    })
    .from(productVariants)
    .where(and(eq(productVariants.organizationId, organizationId), eq(productVariants.id, variantId)))
    .for("update");
  if (!row) throw VARIANT_NOT_FOUND();
  return row;
}

export async function lockProduct(tx: Tx, organizationId: string, productId: string) {
  const [row] = await tx
    .select({
      name: products.name,
      description: products.description,
      unit: products.unit,
      categoryId: products.categoryId,
      brandId: products.brandId,
      supplierId: products.supplierId,
      isActive: products.isActive,
    })
    .from(products)
    .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)))
    .for("update");
  if (!row) throw PRODUCT_NOT_FOUND();
  return row;
}

/** Drops empty values so creation entries list only what was filled in. */
export function filledFields(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined));
}
