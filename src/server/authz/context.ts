import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import {
  membershipRegions,
  membershipStores,
  organizationMemberships,
  organizations,
  rolePermissions,
  roles,
  stores,
} from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { getCurrentSession, type CurrentSession } from "@/server/auth/session";
import { isPermission, type Permission } from "./permissions";
import { findSystemRole, type StoreAccess } from "./system-roles";

export type StoreScope = { all: true } | { all: false; storeIds: readonly string[] };

export interface TenantContext {
  sessionId: string;
  user: CurrentSession["user"];
  organization: { id: string; name: string; planKey: string; timezone: string };
  membershipId: string;
  role: { id: string; key: string; name: string; rank: number; isSystem: boolean };
  permissions: ReadonlySet<Permission>;
  storeAccess: StoreAccess;
  storeScope: StoreScope;
  activeStoreId: string | null;
}

/** Stores reachable through explicit store links or through linked regions. */
export async function resolveMembershipStores(tx: Tx, organizationId: string, membershipId: string) {
  const regionIds = tx
    .select({ id: membershipRegions.regionId })
    .from(membershipRegions)
    .where(and(eq(membershipRegions.organizationId, organizationId), eq(membershipRegions.membershipId, membershipId)));
  const storeIds = tx
    .select({ id: membershipStores.storeId })
    .from(membershipStores)
    .where(and(eq(membershipStores.organizationId, organizationId), eq(membershipStores.membershipId, membershipId)));
  const rows = await tx
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.organizationId, organizationId), or(inArray(stores.id, storeIds), inArray(stores.regionId, regionIds))));
  return rows.map((row) => row.id);
}

export async function loadTenantContext(session: CurrentSession, organizationId: string): Promise<TenantContext | null> {
  return withScope({ organizationId, userId: session.user.id }, async (tx) => {
    const [row] = await tx
      .select({
        membershipId: organizationMemberships.id,
        storeAccess: organizationMemberships.storeAccess,
        organization: {
          id: organizations.id,
          name: organizations.name,
          planKey: organizations.planKey,
          timezone: organizations.timezone,
          status: organizations.status,
        },
        role: { id: roles.id, key: roles.key, name: roles.name, rank: roles.rank, isSystem: roles.isSystem },
      })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .innerJoin(roles, and(eq(roles.id, organizationMemberships.roleId), eq(roles.organizationId, organizationId)))
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, session.user.id),
          eq(organizationMemberships.status, "active"),
        ),
      );
    if (!row || row.organization.status !== "active") return null;

    let granted: readonly string[];
    if (row.role.isSystem) {
      granted = findSystemRole(row.role.key)?.permissions ?? [];
    } else {
      const custom = await tx
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(and(eq(rolePermissions.organizationId, organizationId), eq(rolePermissions.roleId, row.role.id)));
      granted = custom.map((entry) => entry.permission);
    }

    const storeScope: StoreScope =
      row.storeAccess === "all"
        ? { all: true }
        : { all: false, storeIds: await resolveMembershipStores(tx, organizationId, row.membershipId) };
    const activeStoreId =
      session.activeStoreId && isStoreInScope(storeScope, session.activeStoreId) ? session.activeStoreId : null;

    return {
      sessionId: session.id,
      user: session.user,
      organization: {
        id: row.organization.id,
        name: row.organization.name,
        planKey: row.organization.planKey,
        timezone: row.organization.timezone,
      },
      membershipId: row.membershipId,
      role: row.role,
      permissions: new Set(granted.filter(isPermission)),
      storeAccess: row.storeAccess,
      storeScope,
      activeStoreId,
    };
  });
}

export function isStoreInScope(scope: StoreScope, storeId: string) {
  return scope.all || scope.storeIds.includes(storeId);
}

/**
 * The authenticated tenant for this request, or a redirect to the step that is
 * missing (login, password change, organization picker). Cached per request.
 */
export const requireTenantContext = cache(async (): Promise<TenantContext> => {
  const session = await getCurrentSession();
  if (!session) redirect("/entrar");
  if (session.user.mustChangePassword) redirect("/alterar-senha");
  if (!session.activeOrganizationId) redirect(session.user.isPlatformAdmin ? "/plataforma" : "/selecionar-empresa");
  const context = await loadTenantContext(session, session.activeOrganizationId);
  if (!context) redirect("/selecionar-empresa?indisponivel=1");
  return context;
});

/** Store filter for queries; `undefined` means no restriction (organization-wide access). */
export function storeScopeCondition(scope: StoreScope, column: Parameters<typeof inArray>[0]) {
  if (scope.all) return undefined;
  if (scope.storeIds.length === 0) return sql`false`;
  return inArray(column, [...scope.storeIds]);
}

/** RLS settings for a transaction on behalf of this tenant member. */
export function dbScope(context: TenantContext) {
  return { organizationId: context.organization.id, userId: context.user.id };
}
