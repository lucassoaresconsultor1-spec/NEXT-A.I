import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { calendarHolidays, organizationMemberships, salespeople, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { countBusinessDays, type CalendarDay } from "@/lib/business-days";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { loadCalendarOptions } from "@/server/calendar/service";
import { computeSalesMetrics } from "@/server/metrics/sales";
import { assertFeature } from "@/server/plans/entitlements";
import { workingDays } from "@/server/salespeople/schedules";
import { monthRange, percentOf, projectionOf, todayIn, type TargetFilters } from "./schemas";
import { loadCurrentTargets } from "./service";

// Progress of the current goals of a month: achieved = netRevenueCents of the
// sales metrics (m16a) for the goal's scope; projection by working days elapsed
// (store calendar for stores and salespeople; organization-wide closed days and the
// default week for regions and the whole organization).

type Target = Awaited<ReturnType<typeof loadCurrentTargets>>[number];

async function organizationWorkingDays(tx: Tx, organizationId: string, from: CalendarDay, to: CalendarDay) {
  const days = await tx
    .select({ day: calendarHolidays.day })
    .from(calendarHolidays)
    .where(and(eq(calendarHolidays.organizationId, organizationId), isNull(calendarHolidays.storeId), eq(calendarHolidays.closed, true)));
  return countBusinessDays(from, to, { extraHolidays: days.map((row) => row.day).filter((day) => day >= from && day <= to) });
}

async function daysOf(tx: Tx, organizationId: string, target: Target, from: CalendarDay, to: CalendarDay) {
  if (to < from) return 0;
  if (target.scope === "salesperson") return workingDays(tx, organizationId, target.salespersonId!, target.storeId!, from, to);
  if (target.scope === "store") return countBusinessDays(from, to, await loadCalendarOptions(tx, organizationId, target.storeId!, from, to));
  return organizationWorkingDays(tx, organizationId, from, to);
}

async function salesFilters(tx: Tx, organizationId: string, target: Target, period: { from: string; to: string }) {
  if (target.scope === "organization") return period;
  if (target.scope === "region") {
    const regionStores = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, organizationId), eq(stores.regionId, target.regionId!)));
    return regionStores.length ? { ...period, storeIds: regionStores.map((store) => store.id) } : null;
  }
  if (target.scope === "store") return { ...period, storeIds: [target.storeId!] };
  const [person] = await tx
    .select({ userId: organizationMemberships.userId })
    .from(salespeople)
    .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, salespeople.organizationId), eq(organizationMemberships.id, salespeople.membershipId)))
    .where(and(eq(salespeople.organizationId, organizationId), inArray(salespeople.id, [target.salespersonId!])));
  return person ? { ...period, storeIds: [target.storeId!], salespersonUserId: person.userId } : null;
}

export async function targetProgress(context: TenantContext, filters: TargetFilters) {
  assertCan(context, "targets.read");
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const targets = await loadCurrentTargets(tx, context, filters);
    const today = todayIn(context.organization.timezone);
    const result = [];
    for (const target of targets) {
      const period = monthRange(target.month);
      const scoped = await salesFilters(tx, orgId, target, period);
      const achievedCents = scoped ? (await computeSalesMetrics(tx, context, scoped)).netRevenueCents : 0;
      const workingDaysTotal = await daysOf(tx, orgId, target, period.from, period.to);
      const workingDaysElapsed = today < period.from ? 0 : await daysOf(tx, orgId, target, period.from, today < period.to ? today : period.to);
      result.push({
        ...target,
        targetCents: target.amountCents,
        achievedCents,
        percent: percentOf(achievedCents, target.amountCents),
        workingDaysTotal,
        workingDaysElapsed,
        projectionCents: projectionOf(achievedCents, workingDaysElapsed, workingDaysTotal),
      });
    }
    return result;
  });
}
