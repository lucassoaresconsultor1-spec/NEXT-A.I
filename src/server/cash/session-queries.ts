import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { cashMovements, cashRegisters, cashSessionEvents, cashSessions, stores, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { zonedDayStart } from "@/lib/dates";
import { dbScope, isStoreInScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { forbidden } from "@/server/errors";
import { pageResult, pageWindow } from "@/server/pagination";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import { sessionTotals } from "./ledger";
import type { SessionFilters } from "./schemas";

// Read side of cash sessions. cash.read sees the sessions of the stores in
// scope; an operator with only cash.operate sees just the sessions they opened.

const openedByUser = alias(users, "opened_by_user");
const closedByUser = alias(users, "closed_by_user");

function assertCanView(context: TenantContext) {
  if (!can(context, "cash.read") && !can(context, "cash.operate")) throw forbidden();
}

/** Visibility condition: stores in scope, and own sessions only without cash.read. */
function visible(context: TenantContext): SQL | undefined {
  return and(
    storeScopeCondition(context.storeScope, cashSessions.storeId),
    can(context, "cash.read") ? undefined : eq(cashSessions.openedBy, context.user.id),
  );
}

export async function getSessionSummary(context: TenantContext, sessionId: string) {
  assertCanView(context);
  if (!isUuid(sessionId)) return null;
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const [session] = await tx
      .select({
        id: cashSessions.id,
        registerId: cashSessions.registerId,
        registerName: cashRegisters.name,
        storeId: cashSessions.storeId,
        storeName: stores.name,
        status: cashSessions.status,
        openedById: cashSessions.openedBy,
        openedByName: openedByUser.name,
        openedAt: cashSessions.openedAt,
        closedById: cashSessions.closedBy,
        closedByName: closedByUser.name,
        closedAt: cashSessions.closedAt,
        countedCents: cashSessions.countedAmountCents,
        differenceCents: cashSessions.differenceCents,
        closingNote: cashSessions.closingNote,
      })
      .from(cashSessions)
      .innerJoin(cashRegisters, and(eq(cashRegisters.organizationId, cashSessions.organizationId), eq(cashRegisters.id, cashSessions.registerId)))
      .innerJoin(stores, and(eq(stores.organizationId, cashSessions.organizationId), eq(stores.id, cashSessions.storeId)))
      .innerJoin(openedByUser, eq(openedByUser.id, cashSessions.openedBy))
      .leftJoin(closedByUser, eq(closedByUser.id, cashSessions.closedBy))
      .where(and(eq(cashSessions.organizationId, orgId), eq(cashSessions.id, sessionId), visible(context)));
    if (!session) return null;
    const totals = await sessionTotals(tx, orgId, sessionId);
    const movements = await tx
      .select({
        id: cashMovements.id,
        type: cashMovements.type,
        amountCents: cashMovements.amountCents,
        reason: cashMovements.reason,
        createdAt: cashMovements.createdAt,
        createdByName: users.name,
      })
      .from(cashMovements)
      .leftJoin(users, eq(users.id, cashMovements.createdBy))
      .where(and(eq(cashMovements.organizationId, orgId), eq(cashMovements.sessionId, sessionId)))
      .orderBy(asc(cashMovements.createdAt), asc(cashMovements.id))
      .limit(1000);
    const events = await tx
      .select({ type: cashSessionEvents.type, actorName: users.name, reason: cashSessionEvents.reason, at: cashSessionEvents.createdAt })
      .from(cashSessionEvents)
      .leftJoin(users, eq(users.id, cashSessionEvents.actorUserId))
      .where(and(eq(cashSessionEvents.organizationId, orgId), eq(cashSessionEvents.sessionId, sessionId)))
      .orderBy(asc(cashSessionEvents.createdAt));
    const { openedById, openedByName, closedById, closedByName, ...rest } = session;
    return {
      ...rest,
      openedBy: { id: openedById, name: openedByName },
      closedBy: closedById ? { id: closedById, name: closedByName } : null,
      totals,
      movements,
      events,
    };
  });
}

export async function listSessions(context: TenantContext, filters: SessionFilters) {
  assertCanView(context);
  const orgId = context.organization.id;
  const tz = context.organization.timezone;
  const conditions: (SQL | undefined)[] = [eq(cashSessions.organizationId, orgId), visible(context)];
  if (filters.storeId) conditions.push(eq(cashSessions.storeId, filters.storeId));
  if (filters.registerId) conditions.push(eq(cashSessions.registerId, filters.registerId));
  if (filters.status) conditions.push(eq(cashSessions.status, filters.status));
  if (filters.from) conditions.push(gte(cashSessions.openedAt, zonedDayStart(filters.from, tz)));
  if (filters.to) conditions.push(lt(cashSessions.openedAt, zonedDayStart(filters.to, tz, 1)));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const [total] = await tx.select({ value: count() }).from(cashSessions).where(where);
    const rows = await tx
      .select({
        id: cashSessions.id,
        status: cashSessions.status,
        storeId: cashSessions.storeId,
        storeName: stores.name,
        registerId: cashSessions.registerId,
        registerName: cashRegisters.name,
        openedByName: openedByUser.name,
        openedAt: cashSessions.openedAt,
        closedAt: cashSessions.closedAt,
        differenceCents: cashSessions.differenceCents,
      })
      .from(cashSessions)
      .innerJoin(cashRegisters, and(eq(cashRegisters.organizationId, cashSessions.organizationId), eq(cashRegisters.id, cashSessions.registerId)))
      .innerJoin(stores, and(eq(stores.organizationId, cashSessions.organizationId), eq(stores.id, cashSessions.storeId)))
      .innerJoin(openedByUser, eq(openedByUser.id, cashSessions.openedBy))
      .where(where)
      .orderBy(desc(cashSessions.openedAt), desc(cashSessions.id))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}

/** For the POS: the session the member has open in the store, if any. */
export async function findOpenSessionForOperator(context: TenantContext, storeId: string) {
  if (!can(context, "cash.operate") || !isUuid(storeId) || !isStoreInScope(context.storeScope, storeId)) return null;
  const orgId = context.organization.id;
  const [row] = await withScope(dbScope(context), (tx) =>
    tx
      .select({ sessionId: cashSessions.id, registerId: cashSessions.registerId, registerName: cashRegisters.name })
      .from(cashSessions)
      .innerJoin(cashRegisters, and(eq(cashRegisters.organizationId, cashSessions.organizationId), eq(cashRegisters.id, cashSessions.registerId)))
      .where(
        and(
          eq(cashSessions.organizationId, orgId),
          eq(cashSessions.storeId, storeId),
          eq(cashSessions.openedBy, context.user.id),
          eq(cashSessions.status, "open"),
        ),
      ),
  );
  return row ?? null;
}
