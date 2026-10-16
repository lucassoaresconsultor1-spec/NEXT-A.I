import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./tenant";
import { organizations, stores } from "./structure";

// Global identity tables. They carry no organization_id; access goes only through
// src/server/auth and tenant-scoped joins on organization_memberships.

export const userStatus = pgEnum("user_status", ["active", "disabled"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stored trimmed and lower-cased by the auth module.
  email: varchar("email", { length: 254 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  status: userStatus("status").notNull().default("active"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the cookie token; the raw token is never stored.
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id, { onDelete: "set null" }),
    activeStoreId: uuid("active_store_id").references(() => stores.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const authRateLimits = pgTable("auth_rate_limits", {
  // HMAC of the subject (e-mail or IP) plus the bucket name; never the raw value.
  key: varchar("key", { length: 96 }).primaryKey(),
  attempts: integer("attempts").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
});

export const authEventType = pgEnum("auth_event_type", [
  "login_succeeded",
  "login_failed",
  "login_throttled",
  "logout",
  "signup",
  "password_changed",
]);

export const authEvents = pgTable(
  "auth_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: authEventType("type").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // HMAC digests keep events correlatable without storing e-mail or IP in clear text.
    subjectDigest: varchar("subject_digest", { length: 64 }),
    ipDigest: varchar("ip_digest", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_events_user_idx").on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
