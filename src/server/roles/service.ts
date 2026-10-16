import "server-only";
import { and, asc, count, desc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import { organizationMemberships, rolePermissions, roles } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { diffFields, recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide, can, canManageRank, isOwner } from "@/server/authz/guard";
import { ALL_PERMISSIONS, isPermission, PERMISSION_GROUPS, type Permission } from "@/server/authz/permissions";
import { findSystemRole, OWNER_ROLE_KEY, SYSTEM_ROLES } from "@/server/authz/system-roles";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { likePattern } from "@/server/pagination";
import {
  diffPermissions,
  maxAssignableRank,
  nextAvailableKey,
  rankError,
  resolveRolePermissions,
  roleInputSchema,
  roleKeyBase,
  type RoleInput,
} from "./schemas";

export type { RoleInput } from "./schemas";

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  rank: number;
  /** Active + suspended members; null for store-scoped viewers (organization-wide figure). */
  memberCount: number | null;
  /** Catalog order. System roles resolve from code, custom roles from role_permissions. */
  permissions: Permission[];
}

export interface RoleDetail extends RoleSummary {
  createdAt: Date;
  updatedAt: Date;
}

const KEY_CONSTRAINT = "roles_org_key_key";
const KEY_ATTEMPTS = 3;
const SYSTEM_READ_ONLY = () => forbidden("Perfis do sistema não podem ser alterados.");
const ROLE_NOT_FOUND = () => notFound("Perfil não encontrado.");

const isUuid = (value: string) => z.uuid().safeParse(value).success;

function inCatalogOrder(granted: Iterable<string>): Permission[] {
  const set = new Set(granted);
  return ALL_PERMISSIONS.filter((permission) => set.has(permission));
}

const roleColumns = {
  id: roles.id,
  key: roles.key,
  name: roles.name,
  description: roles.description,
  isSystem: roles.isSystem,
  rank: roles.rank,
  createdAt: roles.createdAt,
  updatedAt: roles.updatedAt,
  memberCount: sql<number>`count(${organizationMemberships.id})::int`,
};

/** Roles of the organization with member counts and permissions: two queries in total, no N+1. */
async function selectRoles(tx: Tx, context: TenantContext, roleId?: string) {
  const orgId = context.organization.id;
  const rows = await tx
    .select(roleColumns)
    .from(roles)
    .leftJoin(
      organizationMemberships,
      and(eq(organizationMemberships.organizationId, roles.organizationId), eq(organizationMemberships.roleId, roles.id)),
    )
    .where(and(eq(roles.organizationId, orgId), roleId ? eq(roles.id, roleId) : undefined))
    .groupBy(roles.id)
    .orderBy(desc(roles.rank), asc(roles.name))
    .limit(500);
  const customIds = rows.filter((row) => !row.isSystem).map((row) => row.id);
  const stored = customIds.length
    ? await tx
        .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(and(eq(rolePermissions.organizationId, orgId), inArray(rolePermissions.roleId, customIds)))
    : [];
  const byRole = new Map<string, string[]>();
  for (const entry of stored) byRole.set(entry.roleId, [...(byRole.get(entry.roleId) ?? []), entry.permission]);
  return rows.map((row) => ({
    ...row,
    memberCount: context.storeScope.all ? row.memberCount : null,
    permissions: inCatalogOrder(row.isSystem ? (findSystemRole(row.key)?.permissions ?? []) : (byRole.get(row.id) ?? [])),
  }));
}

/** Every role of the organization, highest rank first. */
export async function listRoles(context: TenantContext): Promise<RoleSummary[]> {
  assertCan(context, "roles.read");
  return withScope(dbScope(context), (tx) => selectRoles(tx, context));
}

/** Null when the role does not exist or belongs to another organization. */
export async function getRole(context: TenantContext, roleId: string): Promise<RoleDetail | null> {
  assertCan(context, "roles.read");
  if (!isUuid(roleId)) return null;
  const [row] = await withScope(dbScope(context), (tx) => selectRoles(tx, context, roleId));
  return row ?? null;
}

const actorLevel = (context: TenantContext) => ({ rank: context.role.rank, isOwner: isOwner(context) });

/** Whether the actor may create or change custom roles at all (permission, scope and a free rank below theirs). */
export function canManageRoles(context: TenantContext) {
  return can(context, "roles.manage") && context.storeScope.all && maxAssignableRank(actorLevel(context)) >= 1;
}

/** Choices for the role form: the catalog flagged with what the actor can grant, and the rank range. */
export function roleFormOptions(context: TenantContext) {
  const maxRank = maxAssignableRank(actorLevel(context));
  return {
    maxRank,
    groups: PERMISSION_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      permissions: group.permissions.map((permission) => ({
        key: permission.key,
        label: permission.label,
        available: context.permissions.has(permission.key),
      })),
    })),
    rankReference: SYSTEM_ROLES.filter((role) => role.key !== OWNER_ROLE_KEY).map((role) => ({ name: role.name, rank: role.rank })),
  };
}

/** Validates shape, rank hierarchy and the permission catalog; returns the clean input. */
function validateInput(context: TenantContext, input: RoleInput) {
  const parsed = roleInputSchema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  const message = rankError(parsed.data.rank, actorLevel(context));
  if (message) throw invalid(message, { rank: [message] });
  const unknown = parsed.data.permissions.filter((permission) => !isPermission(permission));
  if (unknown.length > 0) throw invalid("Permissão inválida.", { permissions: ["Selecione permissões do catálogo."] });
  return { ...parsed.data, permissions: parsed.data.permissions.filter(isPermission) };
}

/** The actor only grants permissions their own role holds. */
function resolvePermissions(context: TenantContext, requested: Permission[], current: Permission[] = []) {
  const { next, granted } = resolveRolePermissions(requested, context.permissions, current);
  if (granted.length > 0) throw forbidden("Você só pode conceder permissões que o seu perfil possui.");
  if (next.length === 0) throw invalid("Selecione ao menos uma permissão.", { permissions: ["Selecione ao menos uma permissão."] });
  return inCatalogOrder(next);
}

async function insertPermissions(tx: Tx, orgId: string, roleId: string, permissions: readonly Permission[]) {
  if (permissions.length === 0) return;
  await tx.insert(rolePermissions).values(permissions.map((permission) => ({ organizationId: orgId, roleId, permission })));
}

export async function createRole(context: TenantContext, input: RoleInput) {
  assertCan(context, "roles.manage");
  assertOrganizationWide(context);
  const data = validateInput(context, input);
  const permissions = resolvePermissions(context, data.permissions);
  const orgId = context.organization.id;
  const base = roleKeyBase(data.name);
  // A concurrent creation may take the same key between the lookup and the insert: retry with a fresh lookup.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withScope(dbScope(context), async (tx) => {
        const existing = await tx
          .select({ key: roles.key })
          .from(roles)
          .where(and(eq(roles.organizationId, orgId), like(roles.key, likePattern(base))));
        const key = nextAvailableKey(base, new Set(existing.map((row) => row.key)));
        const values = { name: data.name, description: data.description ?? null, rank: data.rank };
        const [created] = await tx
          .insert(roles)
          .values({ organizationId: orgId, key, isSystem: false, ...values })
          .returning({ id: roles.id, key: roles.key });
        await insertPermissions(tx, orgId, created.id, permissions);
        await recordAudit(tx, {
          organizationId: orgId,
          actorUserId: context.user.id,
          action: "role.created",
          entityType: "role",
          entityId: created.id,
          changes: { key, ...values, permissions },
        });
        return created;
      });
    } catch (error) {
      if (!isUniqueViolation(error, KEY_CONSTRAINT)) throw error;
      if (attempt >= KEY_ATTEMPTS) throw conflict("Não foi possível gerar o identificador do perfil. Tente novamente.");
    }
  }
}

/** Locks the custom role for the change and checks the hierarchy. */
async function loadManageableRole(tx: Tx, context: TenantContext, roleId: string) {
  if (!isUuid(roleId)) throw ROLE_NOT_FOUND();
  const orgId = context.organization.id;
  const [current] = await tx
    .select({ key: roles.key, name: roles.name, description: roles.description, rank: roles.rank, isSystem: roles.isSystem })
    .from(roles)
    .where(and(eq(roles.organizationId, orgId), eq(roles.id, roleId)))
    .for("update");
  if (!current) throw ROLE_NOT_FOUND();
  if (current.isSystem) throw SYSTEM_READ_ONLY();
  if (!canManageRank(context, current.rank)) throw forbidden("Você só gerencia perfis de nível inferior ao seu.");
  const stored = await tx
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.organizationId, orgId), eq(rolePermissions.roleId, roleId)));
  return { ...current, permissions: inCatalogOrder(stored.map((entry) => entry.permission)) };
}

/** Members holding the role get the new permissions on their next request (context is per request). */
export async function updateRole(context: TenantContext, roleId: string, input: RoleInput) {
  assertCan(context, "roles.manage");
  assertOrganizationWide(context);
  const data = validateInput(context, input);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const current = await loadManageableRole(tx, context, roleId);
    const permissions = resolvePermissions(context, data.permissions, current.permissions);
    const next = { name: data.name, description: data.description ?? null, rank: data.rank };
    await tx
      .update(roles)
      .set({ ...next, updatedAt: new Date() })
      .where(and(eq(roles.organizationId, orgId), eq(roles.id, roleId)));
    await tx.delete(rolePermissions).where(and(eq(rolePermissions.organizationId, orgId), eq(rolePermissions.roleId, roleId)));
    await insertPermissions(tx, orgId, roleId, permissions);
    const { added, removed } = diffPermissions(current.permissions, permissions);
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "role.updated",
      entityType: "role",
      entityId: roleId,
      changes: {
        ...diffFields(current, next, ["name", "description", "rank"]),
        ...(added.length || removed.length ? { permissions: { added, removed } } : {}),
      },
    });
  });
}

/** Custom roles only, and only while no membership (active or suspended) uses them. */
export async function deleteRole(context: TenantContext, roleId: string) {
  assertCan(context, "roles.manage");
  assertOrganizationWide(context);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const current = await loadManageableRole(tx, context, roleId);
    const [inUse] = await tx
      .select({ value: count() })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.roleId, roleId)));
    if (inUse.value > 0) {
      throw invalid(`${inUse.value} membro(s) usam este perfil. Altere o perfil deles antes de excluí-lo.`);
    }
    await tx.delete(roles).where(and(eq(roles.organizationId, orgId), eq(roles.id, roleId)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "role.deleted",
      entityType: "role",
      entityId: roleId,
      changes: { key: current.key, name: current.name, rank: current.rank, permissions: current.permissions },
    });
  });
}
