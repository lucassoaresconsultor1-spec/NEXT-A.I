import "server-only";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { organizationMemberships as memberships, regions, roles, stores, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { hashPassword } from "@/server/auth/password";
import { invalidateOtherSessions } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { assertWithinLimit } from "@/server/plans/entitlements";
import type { z } from "zod";
import {
  countActiveOwners,
  findRole,
  findScopeIds,
  loadMember,
  lockOrganization,
  replaceScopeLinks,
  selectMemberPage,
  storeLabel,
  type LoadedMember,
} from "./queries";
import {
  accessChanges,
  assertCanAssignRole,
  assertCanManage,
  assertKeepsActiveOwner,
  canAssignRole,
  isActiveOwner,
  isOwnerRole,
  manageBlock,
  resolveScope,
} from "./rules";
import {
  addMemberSchema,
  isUuid,
  memberAccessSchema,
  memberStatusInputSchema,
  temporaryPasswordSchema,
  type AddMemberInput,
  type MemberAccessInput,
  type MemberFilters,
  type MemberStatus,
} from "./schemas";

export type { AddMemberInput, MemberAccessInput, MemberFilters, MemberStatus } from "./schemas";

const MEMBER_NOT_FOUND = () => notFound("Membro não encontrado.");
const ROLE_INVALID = () => invalid("Perfil inválido.", { roleId: ["Selecione um perfil válido."] });
const EMAIL_TAKEN = () => conflict("Esta pessoa já faz parte da equipe.", { email: ["E-mail já cadastrado nesta empresa."] });
const SELF_SERVICE_PASSWORD =
  "Por segurança, esta pessoa precisa trocar a senha por conta própria, pela opção Alterar senha depois de entrar.";

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

export async function listMembers(context: TenantContext, filters: MemberFilters) {
  assertCan(context, "members.read");
  return withScope(dbScope(context), (tx) => selectMemberPage(tx, context, filters));
}

/** Member details for the viewer, or null when not visible. Out-of-scope links are never named. */
export async function getMember(context: TenantContext, membershipId: string) {
  assertCan(context, "members.read");
  if (!isUuid(membershipId)) return null;
  const member = await withScope(dbScope(context), (tx) => loadMember(tx, context, membershipId));
  if (!member) return null;
  const allLinks = [...member.regions, ...member.stores];
  const block = manageBlock(context, member);
  return {
    membershipId: member.membershipId,
    name: member.name,
    email: member.email,
    status: member.status,
    storeAccess: member.storeAccess,
    lastLoginAt: member.lastLoginAt,
    createdAt: member.createdAt,
    role: member.role,
    regions: member.regions.filter((link) => link.inViewerScope).map(({ id, name }) => ({ id, name })),
    stores: member.stores.filter((link) => link.inViewerScope).map(({ id, name }) => ({ id, name })),
    hasAccessOutsideViewerScope: allLinks.some((link) => !link.inViewerScope),
    isSelf: member.membershipId === context.membershipId,
    manageBlock: block,
    /** Only computed for manageable members; null means a temporary password can be set. */
    passwordResetBlock: block === null ? await passwordResetBlock(member) : null,
  };
}

export type MemberDetail = NonNullable<Awaited<ReturnType<typeof getMember>>>;

/** Roles the viewer may assign, regions (organization-wide viewers only) and stores in scope. */
export async function getMemberFormOptions(context: TenantContext) {
  assertCan(context, "members.manage");
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const roleRows = await tx
      .select({ id: roles.id, key: roles.key, name: roles.name, description: roles.description, rank: roles.rank, isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.organizationId, orgId))
      .orderBy(desc(roles.rank), asc(roles.name));
    const regionRows = context.storeScope.all
      ? await tx.select({ id: regions.id, name: regions.name }).from(regions).where(eq(regions.organizationId, orgId)).orderBy(asc(regions.name)).limit(500)
      : [];
    const storeRows = await tx
      .select({ id: stores.id, code: stores.code, name: stores.name, status: stores.status })
      .from(stores)
      .where(and(eq(stores.organizationId, orgId), storeScopeCondition(context.storeScope, stores.id)))
      .orderBy(asc(stores.name))
      .limit(1000);
    return {
      roles: roleRows.filter((role) => canAssignRole(context, role)),
      regions: regionRows,
      stores: storeRows,
      organizationWide: context.storeScope.all,
    };
  });
}

/** Every role of the organization, for the list filter. */
export async function listRoleFilterOptions(context: TenantContext) {
  assertCan(context, "members.read");
  return withScope(dbScope(context), (tx) =>
    tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(eq(roles.organizationId, context.organization.id))
      .orderBy(desc(roles.rank), asc(roles.name)),
  );
}

async function resolveAccess(tx: Tx, context: TenantContext, input: MemberAccessInput) {
  const role = await findRole(tx, context.organization.id, input.roleId);
  if (!role) throw ROLE_INVALID();
  assertCanAssignRole(context, role);
  const known = await findScopeIds(tx, context.organization.id, input);
  const scope = resolveScope(context, input, known);
  return { role, known, scope };
}

/**
 * Adds a person to the organization. An e-mail that already has an account is
 * linked as is (name and password untouched); otherwise a user is created with
 * the temporary password and must change it on the first sign-in.
 */
export async function addMember(context: TenantContext, rawInput: AddMemberInput) {
  assertCan(context, "members.manage");
  const input = parseOrThrow(addMemberSchema, rawInput);
  const orgId = context.organization.id;
  // Hashing is slow on purpose; do it before the transaction takes locks.
  const passwordHash = input.initialPassword ? await hashPassword(input.initialPassword) : null;
  try {
    return await withScope(dbScope(context), async (tx) => {
      const { role, scope } = await resolveAccess(tx, context, input);
      await assertWithinLimit(tx, orgId, "members");
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
      let userId = existing?.id;
      if (userId) {
        const [already] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, userId)));
        if (already) throw EMAIL_TAKEN();
      } else {
        if (!passwordHash) {
          throw invalid("Este e-mail ainda não tem cadastro. Defina uma senha provisória.", {
            initialPassword: ["Obrigatória para e-mails sem cadastro."],
          });
        }
        const [created] = await tx
          .insert(users)
          .values({ email: input.email, name: input.name, passwordHash, mustChangePassword: true })
          .returning({ id: users.id });
        userId = created.id;
      }
      const [membership] = await tx
        .insert(memberships)
        .values({ organizationId: orgId, userId, roleId: role.id, storeAccess: scope.storeAccess, createdBy: context.user.id })
        .returning({ id: memberships.id });
      await replaceScopeLinks(tx, orgId, membership.id, scope, false);
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "member.added",
        entityType: "member",
        entityId: membership.id,
        changes: { role: role.name, storeAccess: scope.storeAccess, regions: scope.regionIds.length, stores: scope.storeIds.length },
      });
      return { membershipId: membership.id, linkedExistingUser: Boolean(existing) };
    });
  } catch (error) {
    if (isUniqueViolation(error, "memberships_org_user_key")) throw EMAIL_TAKEN();
    if (isUniqueViolation(error, "users_email_unique")) {
      throw conflict("Este e-mail acabou de ser cadastrado. Tente novamente.", { email: ["Tente adicionar novamente."] });
    }
    throw error;
  }
}

/** Loads a target under the organization lock and applies the manage rules. */
async function lockedTarget(tx: Tx, context: TenantContext, membershipId: string) {
  if (!isUuid(membershipId)) throw MEMBER_NOT_FOUND();
  await lockOrganization(tx, context.organization.id);
  const target = await loadMember(tx, context, membershipId);
  if (!target) throw MEMBER_NOT_FOUND();
  assertCanManage(context, target);
  return target;
}

const memberRow = (orgId: string, membershipId: string) => and(eq(memberships.organizationId, orgId), eq(memberships.id, membershipId));

export async function updateMemberAccess(context: TenantContext, membershipId: string, rawInput: MemberAccessInput) {
  assertCan(context, "members.manage");
  const input = parseOrThrow(memberAccessSchema, rawInput);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const target = await lockedTarget(tx, context, membershipId);
    const { role, known, scope } = await resolveAccess(tx, context, input);
    if (isActiveOwner(target)) assertKeepsActiveOwner(true, isOwnerRole(role), await countActiveOwners(tx, orgId));
    const changes = accessChanges(
      {
        role: { id: target.role.id, name: target.role.name },
        storeAccess: target.storeAccess,
        regions: target.regions,
        stores: target.stores.map((store) => ({ id: store.id, name: storeLabel(store) })),
      },
      {
        role: { id: role.id, name: role.name },
        storeAccess: scope.storeAccess,
        regions: scope.regionIds.map((id) => ({ id, name: known.regionNames.get(id) ?? id })),
        stores: scope.storeIds.map((id) => ({ id, name: known.storeNames.get(id) ?? id })),
      },
    );
    if (Object.keys(changes).length === 0) return;
    await tx.update(memberships).set({ roleId: role.id, storeAccess: scope.storeAccess, updatedAt: new Date() }).where(memberRow(orgId, membershipId));
    await replaceScopeLinks(tx, orgId, membershipId, scope);
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "member.updated",
      entityType: "member",
      entityId: membershipId,
      changes,
    });
  });
}

/** Suspension takes effect on the next request: the tenant context requires an active membership. */
export async function setMemberStatus(context: TenantContext, membershipId: string, rawStatus: MemberStatus) {
  assertCan(context, "members.manage");
  const { status } = parseOrThrow(memberStatusInputSchema, { status: rawStatus });
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const target = await lockedTarget(tx, context, membershipId);
    if (target.status === status) return;
    if (status === "suspended" && isActiveOwner(target)) assertKeepsActiveOwner(true, false, await countActiveOwners(tx, orgId));
    if (status === "active") await assertWithinLimit(tx, orgId, "members");
    await tx.update(memberships).set({ status, updatedAt: new Date() }).where(memberRow(orgId, membershipId));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "member.status_changed",
      entityType: "member",
      entityId: membershipId,
      changes: { status: { from: target.status, to: status } },
    });
  });
}

/** Removes the membership (links cascade); the person's account stays for other organizations. */
export async function removeMember(context: TenantContext, membershipId: string) {
  assertCan(context, "members.manage");
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const target = await lockedTarget(tx, context, membershipId);
    if (isActiveOwner(target)) assertKeepsActiveOwner(true, false, await countActiveOwners(tx, orgId));
    await tx.delete(memberships).where(memberRow(orgId, membershipId));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "member.removed",
      entityType: "member",
      entityId: membershipId,
      changes: { name: target.name, email: target.email, role: target.role.name },
    });
  });
}

/** Why this member's password cannot be reset here (a message), or null when it can. */
async function passwordResetBlock(target: Pick<LoadedMember, "userId" | "isPlatformAdmin">) {
  if (target.isPlatformAdmin) return SELF_SERVICE_PASSWORD;
  // The tenant transaction cannot see this user's other memberships (RLS limits
  // it to the active organization). This separate transaction sets only the
  // target user, so the membership_read policy exposes exactly that user's own
  // memberships, and the query reads nothing but their count: no organization
  // ids, names or other users leave the database.
  const total = await withScope({ userId: target.userId }, async (tx) => {
    const [row] = await tx.select({ value: count() }).from(memberships).where(eq(memberships.userId, target.userId));
    return row.value;
  });
  return total === 1 ? null : `Esta pessoa também participa de outra empresa. ${SELF_SERVICE_PASSWORD}`;
}

/**
 * Sets a temporary password for a member whose account belongs only to this
 * organization, forces a change on the next sign-in and ends their sessions.
 */
export async function resetMemberPassword(context: TenantContext, membershipId: string, temporaryPassword: string) {
  assertCan(context, "members.manage");
  const { temporaryPassword: password } = parseOrThrow(temporaryPasswordSchema, { temporaryPassword });
  const orgId = context.organization.id;
  const target = await withScope(dbScope(context), (tx) => lockedTarget(tx, context, membershipId));
  const blocked = await passwordResetBlock(target);
  if (blocked) throw forbidden(blocked);
  const passwordHash = await hashPassword(password);
  await withScope(dbScope(context), async (tx) => {
    // Re-checked in the writing transaction: access may have changed meanwhile.
    const current = await lockedTarget(tx, context, membershipId);
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, current.userId));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "member.password_reset",
      entityType: "member",
      entityId: membershipId,
      changes: { mustChangePassword: true },
    });
  });
  await invalidateOtherSessions(target.userId);
}
