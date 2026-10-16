import "server-only";
import { and, count, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { pageResult, pageWindow, parsePage } from "@/server/pagination";

export const auditFiltersSchema = z.object({
  entityType: z.enum(["organization", "region", "store", "department", "member", "role"]).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  page: z.unknown().transform(parsePage),
});
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

/**
 * Organization-wide viewers see every event. Store-scoped viewers only see
 * events tied to their stores (organization-level events stay hidden).
 * Date filters are calendar days in the organization time zone.
 */
export async function listAuditLogs(context: TenantContext, filters: AuditFilters, pageSize?: number) {
  assertCan(context, "audit.read");
  const orgId = context.organization.id;
  const tz = context.organization.timezone;
  const conditions: (SQL | undefined)[] = [eq(auditLogs.organizationId, orgId)];
  if (!context.storeScope.all) conditions.push(storeScopeCondition(context.storeScope, auditLogs.storeId));
  if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.from) conditions.push(gte(auditLogs.createdAt, zonedDayStart(filters.from, tz)));
  if (filters.to) conditions.push(lt(auditLogs.createdAt, zonedDayStart(filters.to, tz, 1)));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page, pageSize);

  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(auditLogs).where(where);
    const rows = await tx
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        changes: auditLogs.changes,
        createdAt: auditLogs.createdAt,
        actorName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page, pageSize);
  });
}

/** Start of a calendar day (YYYY-MM-DD) in an IANA time zone, as a UTC instant. */
export function zonedDayStart(day: string, timeZone: string, addDays = 0) {
  const [year, month, date] = day.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, date + addDays);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcGuess));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asZoned = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
  return new Date(utcGuess - (asZoned - utcGuess));
}
