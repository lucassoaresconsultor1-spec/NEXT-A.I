import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { cashSessions, dailyClosings, paymentIntents, reconciliationDivergences, saleRefunds, salePayments, sales, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope } from "@/server/authz/guard";
import { conflict, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { getPaymentProvider } from "@/server/payments/registry";
import { todayIn } from "@/server/targets/schemas";

// Daily store closing (m37a): totals of a local day computed in SQL, saved as an
// append-only version, plus the reconciliation of provider payments of the day
// with the provider's own status and amount (asked outside any transaction).

const keySchema = z.object({ storeId: z.uuid({ error: "Selecione a loja." }), day: z.iso.date({ error: "Informe o dia." }) });
const rangeSchema = z.object({ from: z.iso.date(), to: z.iso.date(), storeId: z.uuid().optional().catch(undefined) });

type Divergence = { intentId: string; providerReference: string; kind: "status_mismatch" | "amount_mismatch" | "unreachable"; ourStatus: string; providerStatus: string | null; ourCents: number; providerCents: number | null };

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

const onDay = (context: TenantContext, timestamp: SQL | typeof sales.completedAt, day: string) =>
  sql`((${timestamp}) at time zone coalesce(${stores.timezone}, ${context.organization.timezone}))::date = ${day}::date`;
type StoreColumns = { organizationId: AnyPgColumn; storeId: AnyPgColumn };
const storeJoin = (table: StoreColumns) => and(eq(stores.organizationId, table.organizationId), eq(stores.id, table.storeId));

/** Provider payments linked to sales completed on the day, as recorded by us. */
async function providerPayments(tx: Tx, context: TenantContext, storeId: string, day: string) {
  return tx
    .select({ id: paymentIntents.id, provider: paymentIntents.provider, reference: paymentIntents.providerReference, status: paymentIntents.status, amountCents: paymentIntents.amountCents })
    .from(paymentIntents)
    .innerJoin(sales, and(eq(sales.organizationId, paymentIntents.organizationId), eq(sales.id, paymentIntents.saleId)))
    .innerJoin(stores, storeJoin(sales))
    .where(
      and(
        eq(paymentIntents.organizationId, context.organization.id),
        eq(sales.storeId, storeId),
        inArray(paymentIntents.status, ["confirmed", "refunded"]),
        isNotNull(paymentIntents.providerReference),
        onDay(context, sales.completedAt, day),
      ),
    )
    .orderBy(asc(paymentIntents.id));
}

async function totals(tx: Tx, context: TenantContext, storeId: string, day: string) {
  const orgId = context.organization.id;
  const ofDay = and(eq(sales.organizationId, orgId), eq(sales.storeId, storeId), inArray(sales.status, ["completed", "cancelled"]), onDay(context, sales.completedAt, day));
  const [sold] = await tx
    .select({ count: sql<number>`count(*)`.mapWith(Number), cents: sql<number>`coalesce(sum(${sales.totalCents}), 0)`.mapWith(Number) })
    .from(sales)
    .innerJoin(stores, storeJoin(sales))
    .where(ofDay);
  const methods = await tx
    .select({ method: salePayments.method, cents: sql<number>`coalesce(sum(${salePayments.amountCents}), 0)`.mapWith(Number) })
    .from(salePayments)
    .innerJoin(sales, and(eq(sales.organizationId, salePayments.organizationId), eq(sales.id, salePayments.saleId)))
    .innerJoin(stores, storeJoin(sales))
    .where(ofDay)
    .groupBy(salePayments.method);
  const refunds = await tx
    .select({ kind: saleRefunds.kind, cents: sql<number>`coalesce(sum(${saleRefunds.amountCents}), 0)`.mapWith(Number) })
    .from(saleRefunds)
    .innerJoin(stores, storeJoin(saleRefunds))
    .where(and(eq(saleRefunds.organizationId, orgId), eq(saleRefunds.storeId, storeId), onDay(context, sql`${saleRefunds.createdAt}`, day)))
    .groupBy(saleRefunds.kind);
  const [cash] = await tx
    .select({ cents: sql<number>`coalesce(sum(${cashSessions.differenceCents}), 0)`.mapWith(Number) })
    .from(cashSessions)
    .innerJoin(stores, storeJoin(cashSessions))
    .where(and(eq(cashSessions.organizationId, orgId), eq(cashSessions.storeId, storeId), eq(cashSessions.status, "closed"), onDay(context, sql`${cashSessions.closedAt}`, day)));
  const byMethod = (method: string) => methods.find((row) => row.method === method)?.cents ?? 0;
  const byKind = (kind: string) => refunds.find((row) => row.kind === kind)?.cents ?? 0;
  return {
    saleCount: sold.count,
    salesCents: sold.cents,
    cancelledCents: byKind("cancellation"),
    returnedCents: byKind("return"),
    cashCents: byMethod("cash"),
    cardExternalCents: byMethod("card_external"),
    pixCents: byMethod("pix"),
    cardProviderCents: byMethod("card_provider"),
    cashDifferenceCents: cash.cents,
  };
}

export async function closeDay(context: TenantContext, rawInput: unknown): Promise<{ id: string; version: number }> {
  assertCan(context, "closings.manage");
  const { storeId, day } = parse(keySchema, rawInput);
  assertStoreInScope(context, storeId);
  const orgId = context.organization.id;
  const payments = await withScope(dbScope(context), async (tx) => {
    const [store] = await tx.select({ timezone: stores.timezone }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, storeId)));
    if (!store) throw notFound("Loja não encontrada.");
    if (day > todayIn(store.timezone ?? context.organization.timezone)) throw invalid("Não é possível fechar um dia que ainda não começou.");
    const [open] = await tx
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .innerJoin(stores, storeJoin(cashSessions))
      .where(
        and(
          eq(cashSessions.organizationId, orgId),
          eq(cashSessions.storeId, storeId),
          eq(cashSessions.status, "open"),
          sql`(${cashSessions.openedAt} at time zone coalesce(${stores.timezone}, ${context.organization.timezone}))::date <= ${day}::date`,
        ),
      )
      .limit(1);
    if (open) throw invalid("Há caixa aberto nesta loja para este dia. Feche os caixas antes do fechamento.");
    return providerPayments(tx, context, storeId, day);
  });

  // Provider calls run outside the transaction; a failure becomes an "unreachable" divergence.
  const provider = getPaymentProvider();
  const divergences: Divergence[] = [];
  let reconciled = 0;
  if (provider) {
    for (const payment of payments) {
      const base = { intentId: payment.id, providerReference: payment.reference!, ourStatus: payment.status, ourCents: payment.amountCents };
      try {
        if (payment.provider !== provider.key) throw new Error("other provider");
        const remote = await provider.getStatus(payment.reference!);
        if (remote.status !== payment.status) divergences.push({ ...base, kind: "status_mismatch", providerStatus: remote.status, providerCents: remote.amountCents });
        else if (remote.amountCents !== payment.amountCents) divergences.push({ ...base, kind: "amount_mismatch", providerStatus: remote.status, providerCents: remote.amountCents });
        else reconciled += 1;
      } catch {
        divergences.push({ ...base, kind: "unreachable", providerStatus: null, providerCents: null });
      }
    }
  }
  const reconciliation = payments.length === 0 ? "no_payments" : !provider ? "not_configured" : divergences.length ? "divergent" : "reconciled";

  try {
    return await withScope(dbScope(context), async (tx) => {
      const sums = await totals(tx, context, storeId, day);
      const [previous] = await tx
        .select({ version: dailyClosings.version })
        .from(dailyClosings)
        .where(and(eq(dailyClosings.organizationId, orgId), eq(dailyClosings.storeId, storeId), eq(dailyClosings.day, day)))
        .orderBy(desc(dailyClosings.version))
        .limit(1);
      const version = (previous?.version ?? 0) + 1;
      const [closing] = await tx
        .insert(dailyClosings)
        .values({ organizationId: orgId, storeId, day, version, ...sums, reconciliation, reconciledCount: reconciled, divergentCount: divergences.length, closedBy: context.user.id })
        .returning({ id: dailyClosings.id });
      if (divergences.length) await tx.insert(reconciliationDivergences).values(divergences.map((entry) => ({ ...entry, organizationId: orgId, closingId: closing.id })));
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "daily_closing.closed",
        entityType: "daily_closing",
        entityId: closing.id,
        storeId,
        changes: { day, version, ...sums, reconciliation, divergences: divergences.length },
      });
      return { id: closing.id, version };
    });
  } catch (error) {
    if (isUniqueViolation(error, "daily_closings_version_key")) throw conflict("O dia foi fechado ao mesmo tempo por outra pessoa. Tente de novo.");
    throw error;
  }
}

/** Latest version of the day with its divergences, or null. */
export async function getClosing(context: TenantContext, storeId: string, day: string) {
  assertCan(context, "closings.read");
  const key = parse(keySchema, { storeId, day });
  assertStoreInScope(context, key.storeId);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const [closing] = await tx
      .select()
      .from(dailyClosings)
      .where(and(eq(dailyClosings.organizationId, orgId), eq(dailyClosings.storeId, key.storeId), eq(dailyClosings.day, key.day)))
      .orderBy(desc(dailyClosings.version))
      .limit(1);
    if (!closing) return null;
    const divergences = await tx.select().from(reconciliationDivergences).where(and(eq(reconciliationDivergences.organizationId, orgId), eq(reconciliationDivergences.closingId, closing.id)));
    return { ...closing, divergences };
  });
}

/** Latest version of each closed day in the period, newest first (bounded). */
export async function listClosings(context: TenantContext, rawFilters: unknown) {
  assertCan(context, "closings.read");
  const filters = parse(rangeSchema, rawFilters);
  return withScope(dbScope(context), (tx) =>
    tx
      .selectDistinctOn([dailyClosings.day, dailyClosings.storeId])
      .from(dailyClosings)
      .where(
        and(
          eq(dailyClosings.organizationId, context.organization.id),
          storeScopeCondition(context.storeScope, dailyClosings.storeId),
          filters.storeId ? eq(dailyClosings.storeId, filters.storeId) : undefined,
          sql`${dailyClosings.day} between ${filters.from}::date and ${filters.to}::date`,
        ),
      )
      .orderBy(desc(dailyClosings.day), dailyClosings.storeId, desc(dailyClosings.version))
      .limit(400),
  );
}
