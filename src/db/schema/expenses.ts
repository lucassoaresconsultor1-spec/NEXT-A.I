import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, pgEnum, pgTable, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations, stores } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Store expenses (m36a) by competence date and category, in integer cents.
// Never deleted: an expense is paid or cancelled with a reason.

export const expenseStatus = pgEnum("expense_status", ["open", "paid", "cancelled"]);

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("expense_categories_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("expense_categories_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    tenantIsolationPolicy(),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    competenceDate: date("competence_date", { mode: "string" }).notNull(),
    description: varchar("description", { length: 160 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    status: expenseStatus("status").notNull().default("open"),
    paidOn: date("paid_on", { mode: "string" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: varchar("cancel_reason", { length: 240 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("expenses_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "expenses_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({ name: "expenses_category_fk", columns: [t.organizationId, t.categoryId], foreignColumns: [expenseCategories.organizationId, expenseCategories.id] }),
    index("expenses_store_competence_idx").on(t.organizationId, t.storeId, t.competenceDate),
    check("expenses_amount_positive", sql`${t.amountCents} > 0`),
    check(
      "expenses_status_fields",
      sql`(${t.status} = 'open' and ${t.paidOn} is null and ${t.cancelledAt} is null)
        or (${t.status} = 'paid' and ${t.paidOn} is not null and ${t.cancelledAt} is null)
        or (${t.status} = 'cancelled' and ${t.cancelledAt} is not null and ${t.cancelReason} is not null)`,
    ),
    tenantIsolationPolicy(),
  ],
);
