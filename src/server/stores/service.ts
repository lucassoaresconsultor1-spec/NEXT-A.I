import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { regions, stores } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { diffFields, recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide, assertStoreInScope } from "@/server/authz/guard";
import { forbidden, isUniqueViolation, notFound } from "@/server/errors";
import { likePattern, pageResult, pageWindow } from "@/server/pagination";
import { assertWithinLimit, countUsage, getOrganizationPlan } from "@/server/plans/entitlements";
import {
  assertRegionOfOrganization,
  codeTaken,
  filledFields,
  isForeignKeyViolation,
  parseStoreInput,
  regionOfStore,
  regionUnavailable,
  STORE_AUDIT_FIELDS,
  STORE_CODE_CONSTRAINT,
  STORE_REGION_CONSTRAINT,
  storeColumns,
  storeDetailColumns,
} from "./queries";
import { isUuid, NO_REGION_FILTER, type StoreFilters, type StoreInput, type StoreSortColumn, type StoreStatus } from "./schemas";

export type { StoreFilters, StoreInput, StoreStatus } from "./schemas";

const STORE_NOT_FOUND = "Loja não encontrada.";

const SORT_EXPRESSIONS: Record<StoreSortColumn, SQL[]> = {
  code: [sql`${stores.code}`],
  name: [sql`lower(${stores.name})`],
  city: [sql`lower(${stores.city})`, sql`${stores.state}`],
  region: [sql`lower(${regions.name})`],
  status: [sql`${stores.status}`],
};

function translateConstraintErrors(error: unknown): never {
  if (isUniqueViolation(error, STORE_CODE_CONSTRAINT)) throw codeTaken();
  if (isForeignKeyViolation(error, STORE_REGION_CONSTRAINT)) throw regionUnavailable();
  throw error;
}

/** Stores within the member's scope, filtered, sorted and paginated on the server. */
export async function listStores(context: TenantContext, filters: StoreFilters) {
  assertCan(context, "stores.read");
  const conditions: (SQL | undefined)[] = [
    eq(stores.organizationId, context.organization.id),
    storeScopeCondition(context.storeScope, stores.id),
  ];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(or(ilike(stores.name, pattern), ilike(stores.code, pattern)));
  }
  if (filters.status) conditions.push(eq(stores.status, filters.status));
  if (filters.regionId === NO_REGION_FILTER) conditions.push(isNull(stores.regionId));
  else if (filters.regionId) conditions.push(eq(stores.regionId, filters.regionId));
  const where = and(...conditions);
  const direction = filters.dir === "desc" ? desc : asc;
  const { limit, offset } = pageWindow(filters.page);

  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(stores).where(where);
    const rows = await tx
      .select({
        id: stores.id,
        code: stores.code,
        name: stores.name,
        city: stores.city,
        state: stores.state,
        status: stores.status,
        regionId: stores.regionId,
        regionName: regions.name,
      })
      .from(stores)
      .leftJoin(regions, regionOfStore())
      .where(where)
      .orderBy(...SORT_EXPRESSIONS[filters.sort].map((expression) => direction(expression)), asc(stores.name), asc(stores.id))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}

/** Full record, or null when it does not exist, belongs to another organization or is out of scope. */
export async function getStore(context: TenantContext, storeId: string) {
  assertCan(context, "stores.read");
  if (!isUuid(storeId)) return null;
  const [store] = await withScope(dbScope(context), (tx) =>
    tx
      .select({ ...storeDetailColumns, regionName: regions.name })
      .from(stores)
      .leftJoin(regions, regionOfStore())
      .where(
        and(
          eq(stores.organizationId, context.organization.id),
          eq(stores.id, storeId),
          storeScopeCondition(context.storeScope, stores.id),
        ),
      ),
  );
  return store ?? null;
}

export type StoreDetail = NonNullable<Awaited<ReturnType<typeof getStore>>>;

/** Plan usage shown before creating a store (organization-wide managers only). */
export async function getStorePlanUsage(context: TenantContext) {
  assertCan(context, "stores.manage");
  assertOrganizationWide(context);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const plan = await getOrganizationPlan(tx, orgId);
    const usage = await countUsage(tx, orgId);
    return { planName: plan.name, maxStores: plan.maxStores, activeStores: usage.stores };
  });
}

/** New stores start active, so they count against the plan limit. */
export async function createStore(context: TenantContext, rawInput: StoreInput) {
  assertCan(context, "stores.manage");
  assertOrganizationWide(context);
  const input = parseStoreInput(rawInput);
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      await assertWithinLimit(tx, orgId, "stores");
      const regionId = input.regionId ?? null;
      if (regionId) await assertRegionOfOrganization(tx, orgId, regionId);
      const values = { ...storeColumns(input), regionId };
      const [created] = await tx
        .insert(stores)
        .values({ organizationId: orgId, ...values, status: "active" })
        .returning({ id: stores.id });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "store.created",
        entityType: "store",
        entityId: created.id,
        storeId: created.id,
        changes: filledFields(values),
      });
      return created;
    });
  } catch (error) {
    translateConstraintErrors(error);
  }
}

/**
 * Scoped managers may edit their stores, but moving a store between regions
 * changes who can see it, so it needs organization-wide access.
 * `input.regionId === undefined` keeps the current region.
 */
export async function updateStore(context: TenantContext, storeId: string, rawInput: StoreInput) {
  assertCan(context, "stores.manage");
  if (!isUuid(storeId)) throw notFound(STORE_NOT_FOUND);
  assertStoreInScope(context, storeId);
  const input = parseStoreInput(rawInput);
  const orgId = context.organization.id;
  const target = and(eq(stores.organizationId, orgId), eq(stores.id, storeId), storeScopeCondition(context.storeScope, stores.id));
  try {
    await withScope(dbScope(context), async (tx) => {
      const [current] = await tx.select(storeDetailColumns).from(stores).where(target);
      if (!current) throw notFound(STORE_NOT_FOUND);
      const regionId = input.regionId === undefined ? current.regionId : input.regionId;
      if (regionId !== current.regionId) {
        if (!context.storeScope.all) throw forbidden("Somente quem tem acesso a todas as lojas pode mudar a região de uma loja.");
        if (regionId) await assertRegionOfOrganization(tx, orgId, regionId);
      }
      const next = { ...storeColumns(input), regionId };
      const changes = diffFields(current, next, STORE_AUDIT_FIELDS);
      if (Object.keys(changes).length === 0) return;
      await tx
        .update(stores)
        .set({ ...next, updatedAt: new Date() })
        .where(target);
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "store.updated",
        entityType: "store",
        entityId: storeId,
        storeId,
        changes,
      });
    });
  } catch (error) {
    translateConstraintErrors(error);
  }
}

/**
 * Stores are never deleted (they will own sales history). Deactivating frees a
 * plan slot; activating takes one again, so the limit is re-checked.
 */
export async function setStoreStatus(context: TenantContext, storeId: string, status: StoreStatus) {
  assertCan(context, "stores.manage");
  if (!isUuid(storeId)) throw notFound(STORE_NOT_FOUND);
  assertStoreInScope(context, storeId);
  const orgId = context.organization.id;
  const target = and(eq(stores.organizationId, orgId), eq(stores.id, storeId), storeScopeCondition(context.storeScope, stores.id));
  return withScope(dbScope(context), async (tx) => {
    const [current] = await tx.select({ status: stores.status }).from(stores).where(target);
    if (!current) throw notFound(STORE_NOT_FOUND);
    if (current.status === status) return { changed: false };
    if (status === "active") await assertWithinLimit(tx, orgId, "stores");
    await tx
      .update(stores)
      .set({ status, updatedAt: new Date() })
      .where(target);
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "store.status_changed",
      entityType: "store",
      entityId: storeId,
      storeId,
      changes: { status: { from: current.status, to: status } },
    });
    return { changed: true };
  });
}
