import "server-only";
import { and, count, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { pageResult, pageWindow, parsePage } from "@/server/pagination";
import { zonedDayStart } from "@/lib/dates";

export const auditFiltersSchema = z.object({
  entityType: z
    .enum([
      "organization",
      "region",
      "store",
      "department",
      "member",
      "role",
      "category",
      "brand",
      "supplier",
      "product",
      "product_variant",
      "inventory_movement",
      "operational_settings",
      "customer",
      "purchase_order",
      "goods_receipt",
      "stock_transfer",
      "inventory_count",
      "import",
      "calendar",
      "salesperson",
      "sales_target",
      "commission_rule",
      "commission_statement",
      "queue_entry",
      "queue_device",
      "cash_register",
      "cash_session",
      "sale",
      "payment_intent",
      "fiscal_document",
      "sale_refund",
    ])
    .optional()
    .catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
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
