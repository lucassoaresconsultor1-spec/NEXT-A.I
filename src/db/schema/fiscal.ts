import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgEnum, pgTable, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { sales } from "./sales";
import { organizations, stores } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Fiscal documents requested for sales (ADR-005). Access key, number, series and
// protocol are only written from a provider answer; the database refuses an
// "authorized" row without them.

export const fiscalDocumentStatus = pgEnum("fiscal_document_status", ["not_configured", "pending", "authorized", "rejected", "cancelled", "contingency"]);
export const fiscalDocumentKind = pgEnum("fiscal_document_kind", ["nfce"]);

export const fiscalDocuments = pgTable(
  "fiscal_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    kind: fiscalDocumentKind("kind").notNull().default("nfce"),
    status: fiscalDocumentStatus("status").notNull(),
    provider: varchar("provider", { length: 40 }),
    providerReference: varchar("provider_reference", { length: 120 }),
    accessKey: varchar("access_key", { length: 44 }),
    number: varchar("number", { length: 20 }),
    series: varchar("series", { length: 5 }),
    protocol: varchar("protocol", { length: 40 }),
    rejectionReason: varchar("rejection_reason", { length: 500 }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("fiscal_documents_org_id_key").on(t.organizationId, t.id),
    unique("fiscal_documents_org_sale_kind_key").on(t.organizationId, t.saleId, t.kind),
    foreignKey({ name: "fiscal_documents_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({ name: "fiscal_documents_sale_fk", columns: [t.organizationId, t.saleId], foreignColumns: [sales.organizationId, sales.id] }),
    index("fiscal_documents_store_status_idx").on(t.organizationId, t.storeId, t.status),
    check(
      "fiscal_documents_authorized_fields",
      sql`${t.status} <> 'authorized' or (${t.accessKey} ~ '^[0-9]{44}$' and ${t.number} is not null and ${t.protocol} is not null)`,
    ),
    check("fiscal_documents_not_configured", sql`${t.status} <> 'not_configured' or ${t.provider} is null`),
    tenantIsolationPolicy(),
  ],
);
