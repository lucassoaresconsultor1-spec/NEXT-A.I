import "server-only";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { departments, organizationMemberships as memberships, regions, roles, stores, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { forbidden } from "@/server/errors";
import { roleJoin, visibleMembers, visibleRegions } from "@/server/members/queries";
import { likePattern } from "@/server/pagination";

// Global search: each group runs only when the viewer may read it, with the
// same scope rules as its module. Wildcards in the query are matched literally.

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 80;
export const SEARCH_GROUP_LIMIT = 8;

export type SearchResult = Awaited<ReturnType<typeof searchEverything>>;

/** Whether the viewer can read at least one searchable area. */
export function canSearch(context: TenantContext) {
  return (["stores.read", "regions.read", "departments.read", "members.read"] as const).some((permission) => can(context, permission));
}

function searchStores(tx: Tx, context: TenantContext, pattern: string) {
  return tx
    .select({ id: stores.id, code: stores.code, name: stores.name, city: stores.city, state: stores.state, status: stores.status })
    .from(stores)
    .where(
      and(
        eq(stores.organizationId, context.organization.id),
        storeScopeCondition(context.storeScope, stores.id),
        or(ilike(stores.name, pattern), ilike(stores.code, pattern)),
      ),
    )
    .orderBy(asc(sql`lower(${stores.name})`), asc(stores.id))
    .limit(SEARCH_GROUP_LIMIT);
}

function searchRegions(tx: Tx, context: TenantContext, pattern: string) {
  return tx
    .select({ id: regions.id, name: regions.name, description: regions.description })
    .from(regions)
    .where(and(eq(regions.organizationId, context.organization.id), visibleRegions(tx, context), ilike(regions.name, pattern)))
    .orderBy(asc(sql`lower(${regions.name})`), asc(regions.id))
    .limit(SEARCH_GROUP_LIMIT);
}

function searchDepartments(tx: Tx, context: TenantContext, pattern: string) {
  return tx
    .select({ id: departments.id, name: departments.name, isActive: departments.isActive })
    .from(departments)
    .where(and(eq(departments.organizationId, context.organization.id), ilike(departments.name, pattern)))
    .orderBy(asc(sql`lower(${departments.name})`), asc(departments.id))
    .limit(SEARCH_GROUP_LIMIT);
}

function searchMembers(tx: Tx, context: TenantContext, pattern: string) {
  return tx
    .select({
      membershipId: memberships.id,
      name: users.name,
      email: users.email,
      roleName: roles.name,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, roleJoin)
    .where(
      and(
        eq(memberships.organizationId, context.organization.id),
        visibleMembers(tx, context),
        or(ilike(users.name, pattern), ilike(users.email, pattern)),
      ),
    )
    .orderBy(asc(sql`lower(${users.name})`), asc(memberships.id))
    .limit(SEARCH_GROUP_LIMIT);
}

/**
 * Up to SEARCH_GROUP_LIMIT matches per group. A group is `null` when the viewer
 * lacks its read permission. Queries outside 2..80 characters return no groups.
 */
export async function searchEverything(context: TenantContext, rawQuery: string) {
  if (!canSearch(context)) throw forbidden();
  const query = rawQuery.trim();
  if (query.length < SEARCH_MIN_LENGTH) return { status: "too_short" as const, query };
  if (query.length > SEARCH_MAX_LENGTH) return { status: "too_long" as const, query: query.slice(0, SEARCH_MAX_LENGTH) };
  const pattern = likePattern(query);
  return withScope(dbScope(context), async (tx) => ({
    status: "ok" as const,
    query,
    stores: can(context, "stores.read") ? await searchStores(tx, context, pattern) : null,
    regions: can(context, "regions.read") ? await searchRegions(tx, context, pattern) : null,
    departments: can(context, "departments.read") ? await searchDepartments(tx, context, pattern) : null,
    members: can(context, "members.read") ? await searchMembers(tx, context, pattern) : null,
  }));
}
