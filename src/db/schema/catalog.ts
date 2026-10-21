import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// ---- Catalog references (organization-wide, shared by every store) ----

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("categories_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("categories_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    tenantIsolationPolicy(),
  ],
);

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("brands_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("brands_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    tenantIsolationPolicy(),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    // CNPJ normalized like organizations.document; unique per organization when present.
    document: varchar("document", { length: 14 }),
    email: varchar("email", { length: 254 }),
    phone: varchar("phone", { length: 11 }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("suppliers_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("suppliers_org_document_idx").on(t.organizationId, t.document).where(sql`${t.document} is not null`),
    index("suppliers_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    tenantIsolationPolicy(),
  ],
);

// ---- Products and variants ----

/** Unit of sale and stock. Only "un" is counted in whole numbers. */
export const productUnit = pgEnum("product_unit", ["un", "kg", "l", "m"]);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    unit: productUnit("unit").notNull().default("un"),
    categoryId: uuid("category_id"),
    brandId: uuid("brand_id"),
    supplierId: uuid("supplier_id"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("products_org_id_key").on(t.organizationId, t.id),
    // Composite keys: references always belong to the same organization.
    foreignKey({
      name: "products_category_fk",
      columns: [t.organizationId, t.categoryId],
      foreignColumns: [categories.organizationId, categories.id],
    }),
    foreignKey({
      name: "products_brand_fk",
      columns: [t.organizationId, t.brandId],
      foreignColumns: [brands.organizationId, brands.id],
    }),
    foreignKey({
      name: "products_supplier_fk",
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [suppliers.organizationId, suppliers.id],
    }),
    index("products_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    index("products_org_category_idx").on(t.organizationId, t.categoryId),
    index("products_org_brand_idx").on(t.organizationId, t.brandId),
    check("products_description_length", sql`char_length(${t.description}) <= 1000`),
    tenantIsolationPolicy(),
  ],
);

/** Sellable and stocked unit: every product has at least one variant (a simple product has one). */
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    // Uppercase internal code, unique per organization.
    sku: varchar("sku", { length: 40 }).notNull(),
    // GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) digits; unique per organization when present.
    barcode: varchar("barcode", { length: 14 }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("product_variants_org_id_key").on(t.organizationId, t.id),
    unique("product_variants_org_sku_key").on(t.organizationId, t.sku),
    uniqueIndex("product_variants_org_barcode_idx").on(t.organizationId, t.barcode).where(sql`${t.barcode} is not null`),
    uniqueIndex("product_variants_product_name_idx").on(t.organizationId, t.productId, sql`lower(${t.name})`),
    // No cascade: products are deactivated, never deleted (they will own sales history).
    foreignKey({
      name: "product_variants_product_fk",
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    tenantIsolationPolicy(),
  ],
);

// ---- Price and cost history (append-only, one row per change) ----
// The current value is the most recent row. Rows are never updated or deleted.
// clock_timestamp() (not now()): changes are made under the variant lock, so a
// later change always gets a later valid_from, even if its transaction began first.

export const productPrices = pgTable(
  "product_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull(),
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("product_prices_org_id_key").on(t.organizationId, t.id),
    foreignKey({
      name: "product_prices_variant_fk",
      columns: [t.organizationId, t.variantId],
      foreignColumns: [productVariants.organizationId, productVariants.id],
    }),
    index("product_prices_variant_idx").on(t.organizationId, t.variantId, t.validFrom.desc()),
    check("product_prices_non_negative", sql`${t.priceCents} >= 0`),
    ...appendOnlyTenantPolicies(),
  ],
);

export const productCosts = pgTable(
  "product_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull(),
    costCents: bigint("cost_cents", { mode: "number" }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("product_costs_org_id_key").on(t.organizationId, t.id),
    foreignKey({
      name: "product_costs_variant_fk",
      columns: [t.organizationId, t.variantId],
      foreignColumns: [productVariants.organizationId, productVariants.id],
    }),
    index("product_costs_variant_idx").on(t.organizationId, t.variantId, t.validFrom.desc()),
    check("product_costs_non_negative", sql`${t.costCents} >= 0`),
    ...appendOnlyTenantPolicies(),
  ],
);

export type Category = typeof categories.$inferSelect;
export type Brand = typeof brands.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
