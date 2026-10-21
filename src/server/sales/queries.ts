import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { customers, saleItems, salePayments, saleRefundItems, saleRefunds, sales, stores, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { zonedDayStart } from "@/lib/dates";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { maskCpf } from "@/server/customers/schemas";
import { forbidden } from "@/server/errors";
import { pageResult, pageWindow } from "@/server/pagination";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import { saleFiltersSchema } from "./schemas";

// Read side of sales. sales.read sees the stores in scope; a member with only
// sales.create sees just the sales they completed. Out of reach = null.

const operator = alias(users, "sale_operator");
const salesperson = alias(users, "sale_salesperson");

function assertCanView(context: TenantContext) {
  if (!can(context, "sales.read") && !can(context, "sales.create")) throw forbidden();
}

export function salesVisibility(context: TenantContext): SQL | undefined {
  return and(storeScopeCondition(context.storeScope, sales.storeId), can(context, "sales.read") ? undefined : eq(sales.operatorUserId, context.user.id));
}

const lastDigits = (nsu: string | null) => (nsu ? `••••${nsu.slice(-4)}` : null);

async function methodsBySale(tx: Tx, organizationId: string, saleIds: string[]) {
  if (saleIds.length === 0) return new Map<string, string[]>();
  const rows = await tx
    .select({ saleId: salePayments.saleId, method: salePayments.method })
    .from(salePayments)
    .where(and(eq(salePayments.organizationId, organizationId), inArray(salePayments.saleId, saleIds)));
  const map = new Map<string, string[]>();
  for (const row of rows) map.set(row.saleId, [...new Set([...(map.get(row.saleId) ?? []), row.method])]);
  return map;
}

export async function listSales(context: TenantContext, rawFilters: unknown) {
  assertCanView(context);
  const filters = saleFiltersSchema.parse(rawFilters ?? {});
  const orgId = context.organization.id;
  const tz = context.organization.timezone;
  const conditions: (SQL | undefined)[] = [eq(sales.organizationId, orgId), salesVisibility(context)];
  if (filters.storeId) conditions.push(eq(sales.storeId, filters.storeId));
  if (filters.status) conditions.push(eq(sales.status, filters.status));
  if (filters.number) conditions.push(eq(sales.number, filters.number));
  if (filters.operatorUserId) conditions.push(eq(sales.operatorUserId, filters.operatorUserId));
  if (filters.customerId) conditions.push(eq(sales.customerId, filters.customerId));
  if (filters.from) conditions.push(gte(sales.completedAt, zonedDayStart(filters.from, tz)));
  if (filters.to) conditions.push(lt(sales.completedAt, zonedDayStart(filters.to, tz, 1)));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const [total] = await tx.select({ value: count() }).from(sales).where(where);
    const rows = await tx
      .select({
        id: sales.id,
        number: sales.number,
        status: sales.status,
        storeId: sales.storeId,
        storeName: stores.name,
        completedAt: sales.completedAt,
        totalCents: sales.totalCents,
        operatorName: operator.name,
        customerName: customers.name,
      })
      .from(sales)
      .innerJoin(stores, and(eq(stores.organizationId, sales.organizationId), eq(stores.id, sales.storeId)))
      .innerJoin(operator, eq(operator.id, sales.operatorUserId))
      .leftJoin(customers, and(eq(customers.organizationId, sales.organizationId), eq(customers.id, sales.customerId)))
      .where(where)
      .orderBy(desc(sales.createdAt), desc(sales.id))
      .limit(limit)
      .offset(offset);
    const methods = await methodsBySale(tx, orgId, rows.map((row) => row.id));
    const counts = rows.length
      ? await tx
          .select({ saleId: saleItems.saleId, value: count() })
          .from(saleItems)
          .where(and(eq(saleItems.organizationId, orgId), inArray(saleItems.saleId, rows.map((row) => row.id))))
          .groupBy(saleItems.saleId)
      : [];
    const itemCount = new Map(counts.map((entry) => [entry.saleId, entry.value]));
    return pageResult(
      rows.map((row) => ({ ...row, itemCount: itemCount.get(row.id) ?? 0, paymentMethods: methods.get(row.id) ?? [] })),
      total.value,
      filters.page,
    );
  });
}

export async function loadSaleDetail(tx: Tx, context: TenantContext, saleId: string) {
  const orgId = context.organization.id;
  const [sale] = await tx
    .select({
      id: sales.id,
      number: sales.number,
      status: sales.status,
      storeId: sales.storeId,
      storeName: stores.name,
      completedAt: sales.completedAt,
      suspendedAt: sales.suspendedAt,
      subtotalCents: sales.subtotalCents,
      discountCents: sales.discountCents,
      surchargeCents: sales.surchargeCents,
      totalCents: sales.totalCents,
      changeCents: sales.changeCents,
      note: sales.note,
      operatorName: operator.name,
      salespersonName: salesperson.name,
      customerId: customers.id,
      customerName: customers.name,
      customerDocument: customers.document,
    })
    .from(sales)
    .innerJoin(stores, and(eq(stores.organizationId, sales.organizationId), eq(stores.id, sales.storeId)))
    .innerJoin(operator, eq(operator.id, sales.operatorUserId))
    .leftJoin(salesperson, eq(salesperson.id, sales.salespersonUserId))
    .leftJoin(customers, and(eq(customers.organizationId, sales.organizationId), eq(customers.id, sales.customerId)))
    .where(and(eq(sales.organizationId, orgId), eq(sales.id, saleId), salesVisibility(context)));
  if (!sale) return null;
  const withCosts = can(context, "catalog.costs.read");
  const itemRows = await tx
    .select({
      id: saleItems.id,
      line: saleItems.line,
      variantId: saleItems.variantId,
      productName: saleItems.productName,
      variantName: saleItems.variantName,
      sku: saleItems.sku,
      unit: saleItems.unit,
      quantity: saleItems.quantity,
      unitPriceCents: saleItems.unitPriceCents,
      unitCostCents: saleItems.unitCostCents,
      discountCents: saleItems.discountCents,
      totalCents: saleItems.totalCents,
    })
    .from(saleItems)
    .where(and(eq(saleItems.organizationId, orgId), eq(saleItems.saleId, saleId)))
    .orderBy(asc(saleItems.line));
  const payments = await tx
    .select({
      method: salePayments.method,
      status: salePayments.status,
      amountCents: salePayments.amountCents,
      tenderedCents: salePayments.tenderedCents,
      changeCents: salePayments.changeCents,
      nsu: salePayments.nsu,
      brand: salePayments.brand,
    })
    .from(salePayments)
    .where(and(eq(salePayments.organizationId, orgId), eq(salePayments.saleId, saleId)))
    .orderBy(asc(salePayments.createdAt));
  const refunds = await tx
    .select({
      id: saleRefunds.id,
      kind: saleRefunds.kind,
      method: saleRefunds.method,
      amountCents: saleRefunds.amountCents,
      reason: saleRefunds.reason,
      createdAt: saleRefunds.createdAt,
      createdByName: users.name,
    })
    .from(saleRefunds)
    .leftJoin(users, eq(users.id, saleRefunds.createdBy))
    .where(and(eq(saleRefunds.organizationId, orgId), eq(saleRefunds.saleId, saleId)))
    .orderBy(asc(saleRefunds.createdAt));
  const returned = await tx
    .select({ saleItemId: saleRefundItems.saleItemId, quantity: sql<string>`coalesce(sum(${saleRefundItems.quantity}), 0)::text` })
    .from(saleRefundItems)
    .innerJoin(saleRefunds, and(eq(saleRefunds.organizationId, saleRefundItems.organizationId), eq(saleRefunds.id, saleRefundItems.refundId)))
    .where(and(eq(saleRefundItems.organizationId, orgId), eq(saleRefunds.saleId, saleId)))
    .groupBy(saleRefundItems.saleItemId);
  const returnedByItem = new Map(returned.map((row) => [row.saleItemId, row.quantity]));
  const { customerId, customerName, customerDocument, ...rest } = sale;
  const fullDocument = can(context, "customers.documents.read");
  return {
    ...rest,
    customer: customerId
      ? { id: customerId, name: customerName, document: customerDocument ? (fullDocument ? customerDocument : maskCpf(customerDocument)) : null }
      : null,
    items: itemRows.map(({ id, unitCostCents, ...item }) => ({ ...item, returnedQuantity: returnedByItem.get(id) ?? "0.000", ...(withCosts ? { unitCostCents } : {}) })),
    refunds,
    payments: payments.map((payment) => ({ ...payment, nsu: lastDigits(payment.nsu) })),
  };
}

export async function getSale(context: TenantContext, saleId: string) {
  assertCanView(context);
  if (!isUuid(saleId)) return null;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, context.organization.id, "pos");
    return loadSaleDetail(tx, context, saleId);
  });
}
