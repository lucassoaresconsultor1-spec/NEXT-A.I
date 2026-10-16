import "server-only";
import { and, asc, count, desc, eq, exists, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import {
  membershipRegions,
  membershipStores,
  organizationMemberships as memberships,
  organizations,
  regions,
  rolePermissions,
  roles,
  stores,
  users,
} from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { findSystemRole, OWNER_ROLE_KEY } from "@/server/authz/system-roles";
import { likePattern, pageResult, pageWindow } from "@/server/pagination";
import type { ResolvedScope } from "./rules";
import type { MemberFilters, MemberSortColumn } from "./schemas";

// Data access building blocks for the members service and the global search.
// Every query filters organization_id explicitly on top of RLS.

const one = () => sql`1`;

/** Memberships with at least one effective store (explicit link or linked region) among `storeIds`. */
function reachesAnyStore(tx: Tx, orgId: string, storeIds: string[]) {
  const viaStores = exists(
    tx
      .select({ one: one() })
      .from(membershipStores)
      .where(
        and(
          eq(membershipStores.organizationId, orgId),
          eq(membershipStores.membershipId, memberships.id),
          inArray(membershipStores.storeId, storeIds),
        ),
      ),
  );
  const viaRegions = exists(
    tx
      .select({ one: one() })
      .from(membershipRegions)
      .innerJoin(stores, and(eq(stores.organizationId, membershipRegions.organizationId), eq(stores.regionId, membershipRegions.regionId)))
      .where(
        and(
          eq(membershipRegions.organizationId, orgId),
          eq(membershipRegions.membershipId, memberships.id),
          inArray(stores.id, storeIds),
        ),
      ),
  );
  return or(viaStores, viaRegions);
}

/**
 * Visibility rule: organization-wide viewers see every membership; others see
 * themselves plus non-"all" memberships whose effective stores intersect theirs.
 */
export function visibleMembers(tx: Tx, context: TenantContext): SQL | undefined {
  if (context.storeScope.all) return undefined;
  const self = eq(memberships.id, context.membershipId);
  const storeIds = [...context.storeScope.storeIds];
  if (storeIds.length === 0) return self;
  return or(self, and(ne(memberships.storeAccess, "all"), reachesAnyStore(tx, context.organization.id, storeIds)));
}

/** Regions a scoped viewer may see: those containing at least one store of their scope. */
export function visibleRegions(tx: Tx, context: TenantContext): SQL | undefined {
  if (context.storeScope.all) return undefined;
  return exists(
    tx
      .select({ one: one() })
      .from(stores)
      .where(
        and(
          eq(stores.organizationId, regions.organizationId),
          eq(stores.regionId, regions.id),
          storeScopeCondition(context.storeScope, stores.id),
        ),
      ),
  );
}

export const roleJoin = and(eq(roles.organizationId, memberships.organizationId), eq(roles.id, memberships.roleId));

const listColumns = {
  membershipId: memberships.id,
  userId: users.id,
  name: users.name,
  email: users.email,
  lastLoginAt: users.lastLoginAt,
  status: memberships.status,
  storeAccess: memberships.storeAccess,
  createdAt: memberships.createdAt,
  role: { id: roles.id, key: roles.key, name: roles.name, rank: roles.rank, isSystem: roles.isSystem },
};

const memberColumns = { ...listColumns, isPlatformAdmin: users.isPlatformAdmin };

export interface ScopeLink {
  id: string;
  name: string;
  /** Stores only: the code, unique in the organization. */
  code?: string;
  /** Whether the viewer may see this region/store; hidden links are never listed by name. */
  inViewerScope: boolean;
}

/** Region and store links of the given memberships, flagged by the viewer's scope. */
export async function loadScopeLinks(tx: Tx, context: TenantContext, membershipIds: string[]) {
  const links = new Map<string, { regions: ScopeLink[]; stores: ScopeLink[] }>();
  for (const id of membershipIds) links.set(id, { regions: [], stores: [] });
  if (membershipIds.length === 0) return links;
  const orgId = context.organization.id;
  const regionScope = visibleRegions(tx, context);
  const storeScope = storeScopeCondition(context.storeScope, stores.id);
  const regionRows = await tx
    .select({
      membershipId: membershipRegions.membershipId,
      id: regions.id,
      name: regions.name,
      inViewerScope: regionScope ? sql<boolean>`${regionScope}` : sql<boolean>`true`,
    })
    .from(membershipRegions)
    .innerJoin(regions, and(eq(regions.organizationId, membershipRegions.organizationId), eq(regions.id, membershipRegions.regionId)))
    .where(and(eq(membershipRegions.organizationId, orgId), inArray(membershipRegions.membershipId, membershipIds)))
    .orderBy(asc(sql`lower(${regions.name})`));
  const storeRows = await tx
    .select({
      membershipId: membershipStores.membershipId,
      id: stores.id,
      name: stores.name,
      code: stores.code,
      inViewerScope: storeScope ? sql<boolean>`${storeScope}` : sql<boolean>`true`,
    })
    .from(membershipStores)
    .innerJoin(stores, and(eq(stores.organizationId, membershipStores.organizationId), eq(stores.id, membershipStores.storeId)))
    .where(and(eq(membershipStores.organizationId, orgId), inArray(membershipStores.membershipId, membershipIds)))
    .orderBy(asc(sql`lower(${stores.name})`));
  for (const { membershipId, ...link } of regionRows) links.get(membershipId)?.regions.push(link);
  for (const { membershipId, ...link } of storeRows) links.get(membershipId)?.stores.push(link);
  return links;
}

/** A visible membership with all of its links, or null (other organization, out of scope, missing). */
export async function loadMember(tx: Tx, context: TenantContext, membershipId: string) {
  const orgId = context.organization.id;
  const [row] = await tx
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, roleJoin)
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.id, membershipId), visibleMembers(tx, context)));
  if (!row) return null;
  const links = (await loadScopeLinks(tx, context, [membershipId])).get(membershipId) ?? { regions: [], stores: [] };
  return { ...row, regions: links.regions, stores: links.stores, storeIds: links.stores.map((store) => store.id) };
}

export type LoadedMember = NonNullable<Awaited<ReturnType<typeof loadMember>>>;

export async function findRole(tx: Tx, orgId: string, roleId: string) {
  const [role] = await tx
    .select({ id: roles.id, key: roles.key, name: roles.name, rank: roles.rank, isSystem: roles.isSystem })
    .from(roles)
    .where(and(eq(roles.organizationId, orgId), eq(roles.id, roleId)));
  return role ? ((await withRolePermissions(tx, orgId, [role]))[0] ?? null) : null;
}

/** Adds resolved permissions: system roles from code, custom roles from role_permissions (one query). */
export async function withRolePermissions<T extends { id: string; key: string; isSystem: boolean }>(tx: Tx, orgId: string, rows: T[]) {
  const customIds = rows.filter((row) => !row.isSystem).map((row) => row.id);
  const granted = new Map<string, string[]>();
  if (customIds.length > 0) {
    const entries = await tx
      .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.organizationId, orgId), inArray(rolePermissions.roleId, customIds)));
    for (const entry of entries) granted.set(entry.roleId, [...(granted.get(entry.roleId) ?? []), entry.permission]);
  }
  return rows.map((row) => ({
    ...row,
    permissions: row.isSystem ? [...(findSystemRole(row.key)?.permissions ?? [])] : (granted.get(row.id) ?? []),
  }));
}

/** Audit label of a store: names may repeat, codes are unique per organization. */
export const storeLabel = (store: { name: string; code?: string }) => (store.code ? `${store.name} (${store.code})` : store.name);

/** Requested region/store ids that exist in the organization, with their audit labels. */
export async function findScopeIds(tx: Tx, orgId: string, input: { regionIds: readonly string[]; storeIds: readonly string[] }) {
  const regionRows = input.regionIds.length
    ? await tx
        .select({ id: regions.id, name: regions.name })
        .from(regions)
        .where(and(eq(regions.organizationId, orgId), inArray(regions.id, [...input.regionIds])))
    : [];
  const storeRows = input.storeIds.length
    ? await tx
        .select({ id: stores.id, name: stores.name, code: stores.code })
        .from(stores)
        .where(and(eq(stores.organizationId, orgId), inArray(stores.id, [...input.storeIds])))
    : [];
  const regionNames = new Map(regionRows.map((row) => [row.id, row.name]));
  const storeNames = new Map(storeRows.map((row) => [row.id, storeLabel(row)]));
  return { regionIds: new Set(regionNames.keys()), storeIds: new Set(storeNames.keys()), regionNames, storeNames };
}

/** Serializes member changes of one organization (owner invariant, plan limit) until commit. */
export async function lockOrganization(tx: Tx, orgId: string) {
  await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId)).for("update");
}

export async function countActiveOwners(tx: Tx, orgId: string) {
  const [row] = await tx
    .select({ value: count() })
    .from(memberships)
    .innerJoin(roles, roleJoin)
    .where(
      and(
        eq(memberships.organizationId, orgId),
        eq(memberships.status, "active"),
        eq(roles.isSystem, true),
        eq(roles.key, OWNER_ROLE_KEY),
      ),
    );
  return row.value;
}

/** Replaces the region/store links of a membership with the resolved scope. */
export async function replaceScopeLinks(tx: Tx, orgId: string, membershipId: string, scope: ResolvedScope, replace = true) {
  if (replace) {
    await tx
      .delete(membershipRegions)
      .where(and(eq(membershipRegions.organizationId, orgId), eq(membershipRegions.membershipId, membershipId)));
    await tx
      .delete(membershipStores)
      .where(and(eq(membershipStores.organizationId, orgId), eq(membershipStores.membershipId, membershipId)));
  }
  if (scope.regionIds.length) {
    await tx.insert(membershipRegions).values(scope.regionIds.map((regionId) => ({ organizationId: orgId, membershipId, regionId })));
  }
  if (scope.storeIds.length) {
    await tx.insert(membershipStores).values(scope.storeIds.map((storeId) => ({ organizationId: orgId, membershipId, storeId })));
  }
}

const SORT_EXPRESSIONS: Record<MemberSortColumn, SQL[]> = {
  name: [sql`lower(${users.name})`],
  email: [sql`${users.email}`],
  role: [sql`${roles.rank}`, sql`lower(${roles.name})`],
  status: [sql`${memberships.status}`],
  lastLogin: [sql`${users.lastLoginAt}`],
};

function orderFor(sort: MemberSortColumn, dir: "asc" | "desc") {
  const direction = dir === "desc" ? desc : asc;
  const primary =
    sort === "lastLogin"
      ? [sql`${users.lastLoginAt} ${sql.raw(dir === "desc" ? "desc" : "asc")} nulls last`]
      : SORT_EXPRESSIONS[sort].map((expression) => direction(expression));
  return [...primary, asc(sql`lower(${users.name})`), asc(memberships.id)];
}

/** One page of visible memberships, filtered and sorted on the server. */
export async function selectMemberPage(tx: Tx, context: TenantContext, filters: MemberFilters) {
  const orgId = context.organization.id;
  const conditions: (SQL | undefined)[] = [eq(memberships.organizationId, orgId), visibleMembers(tx, context)];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(or(ilike(users.name, pattern), ilike(users.email, pattern)));
  }
  if (filters.roleId) conditions.push(eq(memberships.roleId, filters.roleId));
  if (filters.status) conditions.push(eq(memberships.status, filters.status));
  if (filters.storeId) {
    // A store outside the viewer's scope matches nobody: it must not reveal who works there.
    const allowed = context.storeScope.all || context.storeScope.storeIds.includes(filters.storeId);
    conditions.push(
      allowed ? or(eq(memberships.storeAccess, "all"), reachesAnyStore(tx, orgId, [filters.storeId])) : sql`false`,
    );
  }
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  const [total] = await tx
    .select({ value: count() })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, roleJoin)
    .where(where);
  const rows = await tx
    .select(listColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, roleJoin)
    .where(where)
    .orderBy(...orderFor(filters.sort, filters.dir))
    .limit(limit)
    .offset(offset);
  const links = await loadScopeLinks(tx, context, rows.map((row) => row.membershipId));
  const items = rows.map((row) => {
    const entry = links.get(row.membershipId) ?? { regions: [], stores: [] };
    const names = (row.storeAccess === "regions" ? entry.regions : entry.stores)
      .filter((link) => link.inViewerScope)
      .map((link) => link.name);
    return { ...row, scopeNames: names.slice(0, 3), scopeCount: names.length };
  });
  return pageResult(items, total.value, filters.page);
}
