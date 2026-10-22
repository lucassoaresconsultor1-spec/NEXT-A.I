import "server-only";
import { and, eq, inArray, ne, sql, sum } from "drizzle-orm";
import { commissionStatements, organizationMemberships, salespeople } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { forbidden, invalid } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { sumExpensesInTx } from "@/server/expenses/service";
import { assertFeature } from "@/server/plans/entitlements";
import { queueCountsInTx } from "@/server/queue/service";
import { percentOf } from "@/server/targets/schemas";
import { metricsFiltersSchema, type MetricsFilters } from "./filters";
import { salesSumsInTx } from "./sales";

// Complete metrics (m16b) on top of the sales metrics, from the same sources:
//   grossMarginCents = costedRevenueCents − cogsCents (items with a cost snapshot; items without one are counted apart)
//   netProfitCents   = grossMarginCents − expenses of the period (only when expenses were recorded)
//   conversion       = attendances finished with a sale ÷ attendances finished (m13a)
//   commissionsCents = Σ of the not cancelled commission statements of the months in the period (m12a, month granularity)
// Each block is null when the member may not see it.
export async function fullSalesSummary(context: TenantContext, rawFilters: MetricsFilters) {
  if (!can(context, "sales.read") && !can(context, "sales.create")) throw forbidden();
  const parsed = metricsFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) throw invalid("Revise os filtros.", fieldErrorsOf(parsed.error));
  const filters = parsed.data;
  const orgId = context.organization.id;
  const scope = context.storeScope;
  const storeIds = filters.storeIds ?? (scope.all ? undefined : [...scope.storeIds]);
  const byPerson = Boolean(filters.salespersonUserId || filters.operatorUserId);
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const sums = await salesSumsInTx(tx, context, filters);
    const grossMarginCents = sums.costedRevenueCents - sums.cogsCents;
    const margin = can(context, "catalog.costs.read")
      ? {
          costedRevenueCents: sums.costedRevenueCents,
          cogsCents: sums.cogsCents,
          grossMarginCents,
          marginPercent: sums.costedRevenueCents > 0 ? percentOf(grossMarginCents, sums.costedRevenueCents) : "0.0",
          uncostedItems: sums.uncostedItems,
        }
      : null;

    // Expenses belong to stores, not people: no profit when filtering by salesperson or operator.
    let profit: { expensesCents: number; netProfitCents: number; complete: boolean } | null = null;
    if (margin && can(context, "expenses.read") && !byPerson) {
      const expensesCents = await sumExpensesInTx(tx, orgId, { from: filters.from, to: filters.to, storeIds });
      if (expensesCents > 0) profit = { expensesCents, netProfitCents: grossMarginCents - expensesCents, complete: sums.uncostedItems === 0 };
    }

    const conversion = byPerson ? null : await queueCountsInTx(tx, orgId, { from: filters.from, to: filters.to, storeIds });

    let commissions: { commissionsCents: number; months: { from: string; to: string } } | null = null;
    if (can(context, "commissions.read") && !filters.operatorUserId) {
      const months = { from: filters.from.slice(0, 7), to: filters.to.slice(0, 7) };
      const [row] = await tx
        .select({ value: sum(commissionStatements.commissionCents).mapWith(Number) })
        .from(commissionStatements)
        .innerJoin(salespeople, and(eq(salespeople.organizationId, commissionStatements.organizationId), eq(salespeople.id, commissionStatements.salespersonId)))
        .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, salespeople.organizationId), eq(organizationMemberships.id, salespeople.membershipId)))
        .where(
          and(
            eq(commissionStatements.organizationId, orgId),
            ne(commissionStatements.status, "cancelled"),
            sql`${commissionStatements.month} between ${months.from} and ${months.to}`,
            storeIds ? (storeIds.length ? inArray(commissionStatements.storeId, storeIds) : sql`false`) : undefined,
            filters.salespersonUserId ? eq(organizationMemberships.userId, filters.salespersonUserId) : undefined,
          ),
        );
      commissions = { commissionsCents: row?.value ?? 0, months };
    }

    return { ...sums.metrics, period: { from: filters.from, to: filters.to }, margin, profit, conversion, commissions };
  });
}
