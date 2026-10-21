import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, pgEnum, pgTable, primaryKey, smallint, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { organizations, stores } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Company calendar (m32a): extra non-working days per organization (store NULL)
// or per store, and the working weekdays of each store. Feeds the m01 business
// day functions (src/lib/business-days.ts) for schedules and goals.

export const calendarHolidayKind = pgEnum("calendar_holiday_kind", ["holiday", "optional"]);

export const calendarHolidays = pgTable(
  "calendar_holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    // NULL = every store of the organization.
    storeId: uuid("store_id"),
    day: date("day", { mode: "string" }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    kind: calendarHolidayKind("kind").notNull(),
    // Optional days ("ponto facultativo") only stop work when the company closes.
    closed: boolean("closed").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("calendar_holidays_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("calendar_holidays_org_day_key").on(t.organizationId, t.day).where(sql`${t.storeId} is null`),
    uniqueIndex("calendar_holidays_store_day_key").on(t.organizationId, t.storeId, t.day).where(sql`${t.storeId} is not null`),
    foreignKey({ name: "calendar_holidays_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }).onDelete("cascade"),
    index("calendar_holidays_org_day_idx").on(t.organizationId, t.day),
    check("calendar_holidays_holiday_closed", sql`${t.kind} <> 'holiday' or ${t.closed}`),
    tenantIsolationPolicy(),
  ],
);

export const storeWorkWeeks = pgTable(
  "store_work_weeks",
  {
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    // 0 = Sunday … 6 = Saturday; distinct values are enforced by the service.
    weekdays: smallint("weekdays").array().notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.storeId] }),
    foreignKey({ name: "store_work_weeks_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }).onDelete("cascade"),
    check("store_work_weeks_weekdays", sql`cardinality(${t.weekdays}) between 1 and 7 and ${t.weekdays} <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]`),
    tenantIsolationPolicy(),
  ],
);
