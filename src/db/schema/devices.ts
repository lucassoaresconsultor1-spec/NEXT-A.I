import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgEnum, pgTable, primaryKey, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { organizationMemberships } from "./access";
import { users } from "./auth";
import { organizations, stores } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Queue tablets (m33, ADR-011): a device paired with one store by a one-time
// code, then authenticated by a device token stored only as a hash; members act
// on it with their own queue PIN (scrypt).

export const queueDeviceStatus = pgEnum("queue_device_status", ["pending", "active", "revoked"]);
export const deviceCredentialKind = pgEnum("device_credential_kind", ["pairing", "device"]);

export const queueDevices = pgTable(
  "queue_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    name: varchar("name", { length: 60 }).notNull(),
    status: queueDeviceStatus("status").notNull().default("pending"),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("queue_devices_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "queue_devices_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    index("queue_devices_store_idx").on(t.organizationId, t.storeId),
    check("queue_devices_status_fields", sql`(${t.status} = 'active') = (${t.pairedAt} is not null and ${t.revokedAt} is null) and (${t.status} = 'revoked') = (${t.revokedAt} is not null)`),
    tenantIsolationPolicy(),
  ],
);

/** Queue PIN of a member (scrypt hash); one per membership. */
export const queuePins = pgTable(
  "queue_pins",
  {
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull(),
    pinHash: varchar("pin_hash", { length: 255 }).notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.membershipId] }),
    foreignKey({
      name: "queue_pins_membership_fk",
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy(),
  ],
);

/**
 * Global lookup of device credentials (no business data): the hash of a pairing
 * code or device token -> organization and device. Read before any organization
 * is known, like sessions; never exposed.
 */
export const deviceCredentials = pgTable(
  "device_credentials",
  {
    hash: varchar("hash", { length: 64 }).primaryKey(),
    kind: deviceCredentialKind("kind").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("device_credentials_device_idx").on(t.deviceId), check("device_credentials_pairing_expiry", sql`(${t.kind} = 'pairing') = (${t.expiresAt} is not null)`)],
);
