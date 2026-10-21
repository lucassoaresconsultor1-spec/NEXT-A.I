import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, numeric, pgEnum, pgTable, primaryKey, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { brands, categories, productVariants } from "./catalog";
import { organizations, stores } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// CSV imports (m19): the file is never stored, only its rows normalized into typed
// columns by kind (products, customers, opening stock). A preview validates every
// row without writing business data; confirmation applies the "ok" rows in batches.

export const importKind = pgEnum("import_kind", ["products", "customers", "opening_stock"]);
export const importStatus = pgEnum("import_status", ["previewed", "applying", "done", "discarded"]);
export const importRowStatus = pgEnum("import_row_status", ["ok", "error", "skipped", "applied", "failed"]);

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    kind: importKind("kind").notNull(),
    status: importStatus("status").notNull().default("previewed"),
    storeId: uuid("store_id"),
    fileName: varchar("file_name", { length: 200 }).notNull(),
    totalRows: integer("total_rows").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("imports_org_id_key").on(t.organizationId, t.id),
    unique("imports_org_number_key").on(t.organizationId, t.number),
    foreignKey({ name: "imports_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    index("imports_org_created_idx").on(t.organizationId, t.createdAt),
    check("imports_store_kind", sql`(${t.kind} = 'opening_stock') = (${t.storeId} is not null)`),
    check("imports_total_rows", sql`${t.totalRows} between 1 and 5000`),
    check("imports_done_fields", sql`${t.status} <> 'done' or (${t.confirmedAt} is not null and ${t.finishedAt} is not null)`),
    tenantIsolationPolicy(),
  ],
);

/** Which file column feeds each import field. */
export const importMappings = pgTable(
  "import_mappings",
  {
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    importId: uuid("import_id").notNull(),
    field: varchar("field", { length: 32 }).notNull(),
    sourceColumn: varchar("source_column", { length: 120 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.importId, t.field] }),
    foreignKey({ name: "import_mappings_import_fk", columns: [t.organizationId, t.importId], foreignColumns: [imports.organizationId, imports.id] }).onDelete("cascade"),
    tenantIsolationPolicy(),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    importId: uuid("import_id").notNull(),
    line: integer("line").notNull(),
    status: importRowStatus("status").notNull(),
    messages: varchar("messages", { length: 300 }).array().notNull().default(sql`'{}'::varchar[]`),
    // Products: rows with the same group key form one product (one variant per row).
    groupKey: varchar("group_key", { length: 120 }),
    productName: varchar("product_name", { length: 120 }),
    description: varchar("description", { length: 1000 }),
    unit: varchar("unit", { length: 2 }),
    categoryId: uuid("category_id"),
    brandId: uuid("brand_id"),
    variantName: varchar("variant_name", { length: 80 }),
    sku: varchar("sku", { length: 40 }),
    barcode: varchar("barcode", { length: 14 }),
    priceCents: bigint("price_cents", { mode: "number" }),
    // Customers (personal data: removed 30 days after confirmation).
    customerName: varchar("customer_name", { length: 120 }),
    document: varchar("document", { length: 11 }),
    email: varchar("email", { length: 254 }),
    phone: varchar("phone", { length: 11 }),
    // Opening stock.
    variantId: uuid("variant_id"),
    quantity: numeric("quantity", { precision: 14, scale: 3 }),
    createdId: uuid("created_id"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("import_rows_org_id_key").on(t.organizationId, t.id),
    unique("import_rows_import_line_key").on(t.organizationId, t.importId, t.line),
    foreignKey({ name: "import_rows_import_fk", columns: [t.organizationId, t.importId], foreignColumns: [imports.organizationId, imports.id] }).onDelete("cascade"),
    foreignKey({ name: "import_rows_category_fk", columns: [t.organizationId, t.categoryId], foreignColumns: [categories.organizationId, categories.id] }),
    foreignKey({ name: "import_rows_brand_fk", columns: [t.organizationId, t.brandId], foreignColumns: [brands.organizationId, brands.id] }),
    foreignKey({ name: "import_rows_variant_fk", columns: [t.organizationId, t.variantId], foreignColumns: [productVariants.organizationId, productVariants.id] }),
    index("import_rows_import_status_idx").on(t.organizationId, t.importId, t.status, t.line),
    check("import_rows_line_positive", sql`${t.line} >= 2`),
    check("import_rows_price_non_negative", sql`${t.priceCents} is null or ${t.priceCents} >= 0`),
    check("import_rows_quantity_positive", sql`${t.quantity} is null or ${t.quantity} > 0`),
    check("import_rows_applied", sql`(${t.status} = 'applied') = (${t.appliedAt} is not null)`),
    tenantIsolationPolicy(),
  ],
);
