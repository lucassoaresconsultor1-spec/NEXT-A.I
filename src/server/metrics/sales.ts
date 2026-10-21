import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { saleItems, saleRefunds, sales, stores, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { forbidden, invalid } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { pageResult, pageWindow } from "@/server/pagination";
import { assertFeature } from "@/server/plans/entitlements";
import { salesVisibility } from "@/server/sales/queries";
import type { z } from "zod";
import { buildMetrics, EMPTY_SUMS, type DrillDownMetric, type MetricSums, type SalesMetrics } from "./definitions";
import { drillDownSchema, metricsFiltersSchema, seriesSchema, type MetricsFilters, type MetricsGroupBy } from "./filters";

// Sales metrics (m16a), all aggregated in SQL. Three sources share the same
// filters and visibility (sales.read in the store scope; without it, only the
// member's own sales): completed sales by completion day, cancellations and
// returns by the day they were registered. Every number comes from definitions.ts.

type Filters = z.output<typeof metricsFiltersSchema>;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os filtros.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

function assertCanRead(context: TenantContext) {
  if (!can(context, "sales.read") && !can(context, "sales.create")) throw forbidden();
}

const localDay = (context: TenantContext, timestamp: SQL | typeof sales.completedAt) =>
  sql`((${timestamp}) at time zone coalesce(${stores.timezone}, ${context.organization.timezone}))::date`;

function keyOf(context: TenantContext, groupBy: MetricsGroupBy | "all", timestamp: SQL | typeof sales.completedAt): SQL<string> {
  const day = localDay(context, timestamp);
  switch (groupBy) {
    case "day":
      return sql`to_char(${day}, 'YYYY-MM-DD')`;
    case "week":
      return sql`to_char(date_trunc('week', ${day}), 'YYYY-MM-DD')`;
    case "month":
      return sql`to_char(${day}, 'YYYY-MM')`;
    case "store":
      return sql`${sales.storeId}::text`;
    case "salesperson":
      return sql`coalesce(${sales.salespersonUserId}::text, 'none')`;
    case "operator":
      return sql`${sales.operatorUserId}::text`;
    default:
      return sql`'all'`;
  }
}

/** One union of the three sources: per sale and key, the parts each metric adds. */
function contributions(context: TenantContext, filters: Filters, groupBy: MetricsGroupBy | "all", withVisibility = true) {
  const orgId = context.organization.id;
  const common = (timestamp: SQL | typeof sales.completedAt) =>
    and(
      eq(sales.organizationId, orgId),
      withVisibility ? salesVisibility(context) : undefined,
      filters.storeIds ? inArray(sales.storeId, filters.storeIds) : undefined,
      filters.salespersonUserId ? eq(sales.salespersonUserId, filters.salespersonUserId) : undefined,
      filters.operatorUserId ? eq(sales.operatorUserId, filters.operatorUserId) : undefined,
      sql`${localDay(context, timestamp)} between ${filters.from}::date and ${filters.to}::date`,
    );
  const storeJoin = and(eq(stores.organizationId, sales.organizationId), eq(stores.id, sales.storeId));
  const completed = sql`${sales.status} = 'completed'`;
  const soldPart = sql`select ${sales.id} as sale_id, ${keyOf(context, groupBy, sales.completedAt)} as key,
      ${sales.subtotalCents} + ${sales.surchargeCents} as gross, ${sales.discountCents} as discount,
      case when ${completed} then 1 else 0 end as sale_count,
      case when ${completed} then (select coalesce(sum(${saleItems.quantity}), 0) from ${saleItems}
        where ${saleItems.organizationId} = ${sales.organizationId} and ${saleItems.saleId} = ${sales.id}) else 0 end as items,
      0 as cancelled, 0 as returned
    from ${sales} inner join ${stores} on ${storeJoin}
    where ${common(sales.completedAt)} and ${sales.status} in ('completed', 'cancelled')`;
  const refundPart = (kind: "cancellation" | "return", amount: SQL) => sql`select ${sales.id}, ${keyOf(context, groupBy, sql`${saleRefunds.createdAt}`)},
      0, 0, 0, 0, ${kind === "cancellation" ? amount : sql`0`}, ${kind === "return" ? amount : sql`0`}
    from ${saleRefunds}
    inner join ${sales} on ${sales.organizationId} = ${saleRefunds.organizationId} and ${sales.id} = ${saleRefunds.saleId}
    inner join ${stores} on ${storeJoin}
    where ${saleRefunds.organizationId} = ${orgId} and ${saleRefunds.kind} = ${kind} and ${common(sql`${saleRefunds.createdAt}`)}`;
  return sql`${soldPart} union all ${refundPart("cancellation", sql`${sales.totalCents}`)} union all ${refundPart("return", sql`${saleRefunds.amountCents}`)}`;
}

interface SumRow {
  key: string;
  gross: string;
  discount: string;
  sale_count: string;
  items: string;
  cancelled: string;
  returned: string;
}

function toSums(row: SumRow | undefined): MetricSums {
  if (!row) return EMPTY_SUMS;
  const [whole, fraction = ""] = row.items.split(".");
  return {
    grossCents: Number(row.gross),
    discountCents: Number(row.discount),
    cancelledCents: Number(row.cancelled),
    returnedCents: Number(row.returned),
    saleCount: Number(row.sale_count),
    itemsMilli: BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0").slice(0, 3) || "0"),
  };
}

async function aggregate(tx: Tx, context: TenantContext, filters: Filters, groupBy: MetricsGroupBy | "all", withVisibility = true) {
  const result = await tx.execute<SumRow & Record<string, unknown>>(sql`select key, sum(gross)::text as gross, sum(discount)::text as discount,
      sum(sale_count)::text as sale_count, sum(items)::numeric(20, 3)::text as items, sum(cancelled)::text as cancelled, sum(returned)::text as returned
    from (${contributions(context, filters, groupBy, withVisibility)}) as c group by key order by key`);
  return result.rows;
}

/**
 * Same metrics inside the caller's transaction, with the filters as the only limit
 * (no per-operator visibility). For services that already authorized the scope the
 * filters describe, such as the achieved value of a goal (m11a).
 */
export async function computeSalesMetrics(tx: Tx, context: TenantContext, rawFilters: MetricsFilters): Promise<SalesMetrics> {
  const [row] = await aggregate(tx, context, parse(metricsFiltersSchema, rawFilters), "all", false);
  return buildMetrics(toSums(row));
}

export async function salesSummary(context: TenantContext, rawFilters: MetricsFilters): Promise<SalesMetrics & { period: { from: string; to: string } }> {
  assertCanRead(context);
  const filters = parse(metricsFiltersSchema, rawFilters);
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, context.organization.id, "pos");
    const [row] = await aggregate(tx, context, filters, "all");
    return { ...buildMetrics(toSums(row)), period: { from: filters.from, to: filters.to } };
  });
}

export async function salesSeries(context: TenantContext, rawFilters: MetricsFilters & { groupBy: MetricsGroupBy }) {
  assertCanRead(context);
  const filters = parse(metricsFiltersSchema, rawFilters);
  const { groupBy } = parse(seriesSchema, rawFilters);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const rows = await aggregate(tx, context, filters, groupBy);
    const labels = new Map<string, string>([["none", "Sem vendedor"]]);
    const ids = rows.map((row) => row.key).filter((key) => key !== "none");
    if (groupBy === "store" && ids.length) {
      for (const store of await tx.select({ id: stores.id, name: stores.name }).from(stores).where(and(eq(stores.organizationId, orgId), inArray(stores.id, ids)))) labels.set(store.id, store.name);
    }
    if ((groupBy === "salesperson" || groupBy === "operator") && ids.length) {
      for (const user of await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))) labels.set(user.id, user.name);
    }
    return rows.map((row) => ({ key: row.key, label: labels.get(row.key) ?? row.key, metrics: buildMetrics(toSums(row)) }));
  });
}

const CONTRIBUTION: Record<DrillDownMetric, SQL> = {
  grossRevenueCents: sql`sum(gross)`,
  discountCents: sql`sum(discount)`,
  cancelledCents: sql`sum(cancelled)`,
  returnedCents: sql`sum(returned)`,
  netRevenueCents: sql`sum(gross - discount - cancelled - returned)`,
  saleCount: sql`sum(sale_count)`,
};

/** Sales behind a metric; `contribution` is cents for money metrics and 1 per sale for saleCount, and the contributions add up to the metric. */
export async function salesDrillDown(context: TenantContext, rawFilters: MetricsFilters & { metric: DrillDownMetric; page?: unknown }) {
  assertCanRead(context);
  const filters = parse(metricsFiltersSchema, rawFilters);
  const { metric, page } = parse(drillDownSchema, rawFilters);
  const { limit, offset } = pageWindow(page);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const contribution = CONTRIBUTION[metric];
    const result = await tx.execute<{ sale_id: string; number: number; store_name: string; completed_at: string; total_cents: string; contribution: string; total: string }>(sql`
      with per_sale as (
        select sale_id, ${contribution} as contribution from (${contributions(context, filters, "all")}) as c
        group by sale_id having ${contribution} <> 0
      )
      select p.sale_id, s.number, st.name as store_name, s.completed_at, s.total_cents::text, p.contribution::text, count(*) over ()::text as total
      from per_sale p
      inner join sales s on s.organization_id = ${orgId} and s.id = p.sale_id
      inner join stores st on st.organization_id = s.organization_id and st.id = s.store_id
      order by s.completed_at desc, s.id
      limit ${limit} offset ${offset}`);
    const rows = result.rows.map((row) => ({
      saleId: row.sale_id,
      number: Number(row.number),
      storeName: row.store_name,
      completedAt: new Date(row.completed_at),
      totalCents: Number(row.total_cents),
      contribution: Number(row.contribution),
    }));
    return pageResult(rows, Number(result.rows[0]?.total ?? 0), page);
  });
}
