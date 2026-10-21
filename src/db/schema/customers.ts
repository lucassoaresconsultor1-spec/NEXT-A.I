import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Customers of the organization, shared by every store. Minimal personal data
// (LGPD): CPF, e-mail and phone are optional; the service masks the CPF for
// members without customers.documents.read and keeps contacts out of logs.

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    // CPF digits only.
    document: varchar("document", { length: 11 }),
    email: varchar("email", { length: 254 }),
    // Phone digits only (DDD + number).
    phone: varchar("phone", { length: 11 }),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("customers_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("customers_org_document_idx").on(t.organizationId, t.document).where(sql`${t.document} is not null`),
    index("customers_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    index("customers_org_email_idx").on(t.organizationId, t.email).where(sql`${t.email} is not null`),
    index("customers_org_phone_idx").on(t.organizationId, t.phone).where(sql`${t.phone} is not null`),
    check("customers_document_digits", sql`${t.document} is null or ${t.document} ~ '^[0-9]{11}$'`),
    check("customers_phone_digits", sql`${t.phone} is null or ${t.phone} ~ '^[0-9]{10,11}$'`),
    check(
      "customers_consent_date",
      sql`(${t.marketingConsent} and ${t.consentAt} is not null) or (not ${t.marketingConsent} and ${t.consentAt} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);
