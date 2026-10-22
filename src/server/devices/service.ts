import "server-only";
import { randomInt } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { departments, deviceCredentials, organizationMemberships, queueDevices, queuePins, stores, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { hitRateLimit, releaseRateLimit, type RateLimitRule } from "@/server/auth/rate-limit";
import { generateSessionToken, hashSessionToken, keyedDigest } from "@/server/auth/tokens";
import { recordAudit } from "@/server/audit/record";
import { dbScope, isStoreInScope, loadTenantContext, resolveMembershipStores, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope } from "@/server/authz/guard";
import type { Permission } from "@/server/authz/permissions";
import { DomainError, invalid, notFound } from "@/server/errors";
import { requiredText } from "@/server/forms";
import { isUuid } from "@/server/stores/schemas";
import { z } from "zod";
import { verifyMemberPin } from "./pin";

// Queue tablets (m33, ADR-011). Pairing code: one-time, 10 minutes, kept as an
// HMAC. Device token: 256 bits, kept as SHA-256 in the global device_credentials
// lookup. Every action on a tablet runs as the member identified by their queue
// PIN, restricted to the queue permissions and to the tablet's store.

const PAIRING_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIR_PER_IP: RateLimitRule = { limit: 10, windowSeconds: 15 * 60 };
const PIN_PER_MEMBER: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 };
const PIN_PER_DEVICE: RateLimitRule = { limit: 20, windowSeconds: 15 * 60 };
const QUEUE_PERMISSIONS: Permission[] = ["queue.read", "queue.operate", "queue.assign_manual"];
const DEVICE_NOT_FOUND = () => notFound("Aparelho não encontrado.");
const unauthenticated = () => new DomainError("Este aparelho não está pareado. Peça ao gerente um código novo.", "unauthenticated");

const deviceSchema = z.object({ storeId: z.uuid({ error: "Selecione a loja." }), name: requiredText("o nome do aparelho", 60, 2) });

function newPairingCode() {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

async function issuePairingCode(tx: Tx, organizationId: string, deviceId: string) {
  const pairingCode = newPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  await tx.delete(deviceCredentials).where(and(eq(deviceCredentials.deviceId, deviceId), eq(deviceCredentials.kind, "pairing")));
  await tx.insert(deviceCredentials).values({ hash: keyedDigest(`pairing:${pairingCode}`), kind: "pairing", organizationId, deviceId, expiresAt });
  return { pairingCode, expiresAt };
}

async function audit(tx: Tx, organizationId: string, actorUserId: string | null, action: string, device: { id: string; storeId: string }, changes: Record<string, unknown> = {}) {
  await recordAudit(tx, { organizationId, actorUserId, action: `queue_device.${action}`, entityType: "queue_device", entityId: device.id, storeId: device.storeId, changes });
}

async function lockDevice(tx: Tx, context: TenantContext, deviceId: string) {
  if (!isUuid(deviceId)) throw DEVICE_NOT_FOUND();
  const [device] = await tx
    .select({ id: queueDevices.id, storeId: queueDevices.storeId, status: queueDevices.status, name: queueDevices.name })
    .from(queueDevices)
    .where(and(eq(queueDevices.organizationId, context.organization.id), eq(queueDevices.id, deviceId), storeScopeCondition(context.storeScope, queueDevices.storeId)))
    .for("update");
  if (!device) throw DEVICE_NOT_FOUND();
  return device;
}

export async function createDevice(context: TenantContext, rawInput: unknown) {
  assertCan(context, "queue.devices.manage");
  const parsed = deviceSchema.safeParse(rawInput);
  if (!parsed.success) throw invalid("Revise os campos destacados.", { name: parsed.error.issues.map((issue) => issue.message) });
  assertStoreInScope(context, parsed.data.storeId);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const [store] = await tx.select({ status: stores.status }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, parsed.data.storeId)));
    if (!store) throw notFound("Loja não encontrada.");
    if (store.status !== "active") throw invalid("Loja inativa.");
    const [device] = await tx.insert(queueDevices).values({ organizationId: orgId, ...parsed.data, createdBy: context.user.id }).returning({ id: queueDevices.id, storeId: queueDevices.storeId });
    const code = await issuePairingCode(tx, orgId, device.id);
    await audit(tx, orgId, context.user.id, "created", device, { name: parsed.data.name });
    return { id: device.id, ...code };
  });
}

export async function renewPairingCode(context: TenantContext, deviceId: string) {
  assertCan(context, "queue.devices.manage");
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const device = await lockDevice(tx, context, deviceId);
    if (device.status !== "pending") throw invalid("Só aparelhos ainda não pareados recebem código novo.");
    const code = await issuePairingCode(tx, orgId, device.id);
    await audit(tx, orgId, context.user.id, "pairing_renewed", device);
    return code;
  });
}

export async function revokeDevice(context: TenantContext, deviceId: string): Promise<void> {
  assertCan(context, "queue.devices.manage");
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const device = await lockDevice(tx, context, deviceId);
    if (device.status === "revoked") return;
    await tx.delete(deviceCredentials).where(eq(deviceCredentials.deviceId, device.id));
    await tx.update(queueDevices).set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(queueDevices.organizationId, orgId), eq(queueDevices.id, device.id)));
    await audit(tx, orgId, context.user.id, "revoked", device);
  });
}

export async function listDevices(context: TenantContext, filters: { storeId?: string } = {}) {
  assertCan(context, "queue.devices.manage");
  return withScope(dbScope(context), (tx) =>
    tx
      .select({ id: queueDevices.id, storeId: queueDevices.storeId, name: queueDevices.name, status: queueDevices.status, pairedAt: queueDevices.pairedAt, lastSeenAt: queueDevices.lastSeenAt })
      .from(queueDevices)
      .where(
        and(
          eq(queueDevices.organizationId, context.organization.id),
          storeScopeCondition(context.storeScope, queueDevices.storeId),
          filters.storeId && isUuid(filters.storeId) ? eq(queueDevices.storeId, filters.storeId) : undefined,
        ),
      )
      .orderBy(asc(queueDevices.name)),
  );
}

/** Tablet side, without a user session: exchanges a valid one-time code for the device token. */
export async function pairDevice(rawCode: string, ip: string): Promise<{ token: string; deviceId: string }> {
  const ipKey = keyedDigest(`queue-pair:ip:${ip}`);
  if (!(await hitRateLimit(ipKey, PAIR_PER_IP)).allowed) throw invalid("Muitas tentativas. Aguarde alguns minutos.");
  const code = String(rawCode ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hash = keyedDigest(`pairing:${code}`);
  const [credential] = await getDb().select({ organizationId: deviceCredentials.organizationId }).from(deviceCredentials).where(and(eq(deviceCredentials.hash, hash), eq(deviceCredentials.kind, "pairing")));
  const refused = () => invalid("Código inválido ou expirado.");
  if (!credential) throw refused();
  const result = await withScope({ organizationId: credential.organizationId }, async (tx) => {
    // Deleting the code is what makes it single-use, also under concurrent attempts.
    const [used] = await tx
      .delete(deviceCredentials)
      .where(and(eq(deviceCredentials.hash, hash), eq(deviceCredentials.kind, "pairing"), gt(deviceCredentials.expiresAt, new Date())))
      .returning({ deviceId: deviceCredentials.deviceId });
    if (!used) return null;
    const [device] = await tx
      .update(queueDevices)
      .set({ status: "active", pairedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(queueDevices.organizationId, credential.organizationId), eq(queueDevices.id, used.deviceId), eq(queueDevices.status, "pending")))
      .returning({ id: queueDevices.id, storeId: queueDevices.storeId });
    if (!device) return null;
    const token = generateSessionToken();
    await tx.insert(deviceCredentials).values({ hash: hashSessionToken(token), kind: "device", organizationId: credential.organizationId, deviceId: device.id });
    await audit(tx, credential.organizationId, null, "paired", device);
    return { token, deviceId: device.id };
  });
  if (!result) throw refused();
  await releaseRateLimit(ipKey);
  return result;
}

export interface QueueDevice {
  id: string;
  organizationId: string;
  storeId: string;
  name: string;
}

/** Active device of a token, or null (unknown, revoked or never paired). */
export async function deviceFromToken(token: string | undefined): Promise<QueueDevice | null> {
  if (!token) return null;
  const [credential] = await getDb()
    .select({ organizationId: deviceCredentials.organizationId, deviceId: deviceCredentials.deviceId })
    .from(deviceCredentials)
    .where(and(eq(deviceCredentials.hash, hashSessionToken(token)), eq(deviceCredentials.kind, "device")));
  if (!credential) return null;
  return withScope({ organizationId: credential.organizationId }, async (tx) => {
    const [device] = await tx
      .update(queueDevices)
      .set({ lastSeenAt: sql`now()` })
      .where(and(eq(queueDevices.organizationId, credential.organizationId), eq(queueDevices.id, credential.deviceId), eq(queueDevices.status, "active")))
      .returning({ id: queueDevices.id, storeId: queueDevices.storeId, name: queueDevices.name });
    return device ? { ...device, organizationId: credential.organizationId } : null;
  });
}

/** Members who can identify themselves on the tablet: a PIN set and the tablet's store in reach. */
export async function deviceMembers(token: string | undefined): Promise<{ membershipId: string; name: string }[]> {
  const device = await deviceFromToken(token);
  if (!device) throw unauthenticated();
  return withScope({ organizationId: device.organizationId }, async (tx) => {
    const rows = await tx
      .select({ membershipId: organizationMemberships.id, name: users.name, storeAccess: organizationMemberships.storeAccess })
      .from(queuePins)
      .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, queuePins.organizationId), eq(organizationMemberships.id, queuePins.membershipId)))
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(and(eq(queuePins.organizationId, device.organizationId), eq(organizationMemberships.status, "active"), eq(users.status, "active")))
      .orderBy(asc(users.name));
    const reach = [];
    for (const row of rows) {
      if (row.storeAccess === "all" || (await resolveMembershipStores(tx, device.organizationId, row.membershipId)).includes(device.storeId)) {
        reach.push({ membershipId: row.membershipId, name: row.name });
      }
    }
    return reach;
  });
}

/**
 * Context of the member who typed their PIN on the tablet, for the queue services:
 * only their queue permissions and only the tablet's store. Failures count per
 * member and per device; a success gives back the attempts it counted.
 */
/** Active departments of the tablet's organization, for the sector of an arrival. */
export async function deviceDepartments(token: string | undefined): Promise<{ id: string; name: string }[]> {
  const device = await deviceFromToken(token);
  if (!device) throw unauthenticated();
  return withScope({ organizationId: device.organizationId }, (tx) =>
    tx.select({ id: departments.id, name: departments.name }).from(departments).where(and(eq(departments.organizationId, device.organizationId), eq(departments.isActive, true))).orderBy(asc(departments.name)),
  );
}

/**
 * Context of a member on the tablet, for the queue services: only their queue
 * permissions and only the tablet's store; null when the member is no longer active
 * or does not reach the store with queue.read.
 */
export async function memberContext(device: QueueDevice, membershipId: string): Promise<TenantContext | null> {
  if (!isUuid(membershipId)) return null;
  const [member] = await withScope({ organizationId: device.organizationId }, (tx) =>
    tx
      .select({ userId: users.id, email: users.email, name: users.name })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(and(eq(organizationMemberships.organizationId, device.organizationId), eq(organizationMemberships.id, membershipId), eq(organizationMemberships.status, "active"), eq(users.status, "active"))),
  );
  if (!member) return null;
  const context = await loadTenantContext(
    {
      id: `device:${device.id}`,
      activeOrganizationId: device.organizationId,
      activeStoreId: device.storeId,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: member.userId, email: member.email, name: member.name, isPlatformAdmin: false, mustChangePassword: false },
    },
    device.organizationId,
  );
  if (!context || !isStoreInScope(context.storeScope, device.storeId) || !context.permissions.has("queue.read")) return null;
  return {
    ...context,
    permissions: new Set(QUEUE_PERMISSIONS.filter((permission) => context.permissions.has(permission))),
    storeScope: { all: false, storeIds: [device.storeId] },
    activeStoreId: device.storeId,
  };
}

/**
 * Context of the member who typed their PIN on the tablet (see memberContext).
 * Failures count per member and per device; a success gives back the attempts it counted.
 */
export async function deviceActor(token: string | undefined, input: { membershipId: string; pin: string }): Promise<TenantContext> {
  const device = await deviceFromToken(token);
  if (!device) throw unauthenticated();
  const refused = () => invalid("Pessoa ou PIN incorretos.");
  if (!isUuid(input?.membershipId) || typeof input.pin !== "string") throw refused();
  const keys = [keyedDigest(`queue-pin:device:${device.id}`), keyedDigest(`queue-pin:member:${input.membershipId}`)];
  const limits = [await hitRateLimit(keys[0], PIN_PER_DEVICE), await hitRateLimit(keys[1], PIN_PER_MEMBER)];
  if (limits.some((limit) => !limit.allowed)) throw invalid("Muitas tentativas. Aguarde alguns minutos.");
  const ok = await withScope({ organizationId: device.organizationId }, (tx) => verifyMemberPin(tx, device.organizationId, input.membershipId, input.pin));
  const context = ok ? await memberContext(device, input.membershipId) : null;
  if (!context) throw refused();
  for (const key of keys) await releaseRateLimit(key);
  return context;
}
