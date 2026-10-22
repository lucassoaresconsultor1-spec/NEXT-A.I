import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { organizationMemberships, queuePins, roles } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/server/auth/password";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, canManageRank } from "@/server/authz/guard";
import { forbidden, invalid, notFound } from "@/server/errors";
import { isUuid } from "@/server/stores/schemas";

// Queue PIN of a member (ADR-011): 6 digits, stored as a scrypt hash, set by the
// member in a normal session; managers may only clear it (lower levels).

const SEQUENCES = "0123456789012345 9876543210987654";

export const pinSchema = z.object({
  pin: z
    .string({ error: "Informe o PIN." })
    .regex(/^\d{6}$/, { error: "Use 6 números." })
    .refine((pin) => !/^(\d)\1{5}$/.test(pin) && !SEQUENCES.includes(pin), { error: "Escolha um PIN que não seja sequência nem repetição." }),
});

export async function setOwnQueuePin(context: TenantContext, rawInput: unknown): Promise<void> {
  assertCan(context, "queue.read");
  const parsed = pinSchema.safeParse(rawInput);
  if (!parsed.success) throw invalid("Revise os campos destacados.", { pin: parsed.error.issues.map((issue) => issue.message) });
  const pinHash = await hashPassword(parsed.data.pin);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    await tx
      .insert(queuePins)
      .values({ organizationId: orgId, membershipId: context.membershipId, pinHash })
      .onConflictDoUpdate({ target: [queuePins.organizationId, queuePins.membershipId], set: { pinHash, updatedAt: new Date() } });
    await recordAudit(tx, { organizationId: orgId, actorUserId: context.user.id, action: "queue_pin.set", entityType: "queue_device", entityId: context.membershipId, changes: {} });
  });
}

export async function clearQueuePin(context: TenantContext, membershipId: string): Promise<void> {
  assertCan(context, "queue.devices.manage");
  if (!isUuid(membershipId)) throw notFound("Membro não encontrado.");
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const [member] = await tx
      .select({ rank: roles.rank })
      .from(organizationMemberships)
      .innerJoin(roles, and(eq(roles.organizationId, organizationMemberships.organizationId), eq(roles.id, organizationMemberships.roleId)))
      .where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.id, membershipId)));
    if (!member) throw notFound("Membro não encontrado.");
    if (!canManageRank(context, member.rank)) throw forbidden("Você só gerencia membros de nível inferior ao seu.");
    await tx.delete(queuePins).where(and(eq(queuePins.organizationId, orgId), eq(queuePins.membershipId, membershipId)));
    await recordAudit(tx, { organizationId: orgId, actorUserId: context.user.id, action: "queue_pin.cleared", entityType: "queue_device", entityId: membershipId, changes: {} });
  });
}

/** Checks the PIN of a member in the caller's transaction; a missing PIN costs the same time as a wrong one. */
export async function verifyMemberPin(tx: Tx, organizationId: string, membershipId: string, pin: string) {
  const [row] = await tx.select({ pinHash: queuePins.pinHash }).from(queuePins).where(and(eq(queuePins.organizationId, organizationId), eq(queuePins.membershipId, membershipId)));
  if (!row) {
    await verifyAgainstDummy(pin);
    return false;
  }
  return verifyPassword(pin, row.pinHash);
}
