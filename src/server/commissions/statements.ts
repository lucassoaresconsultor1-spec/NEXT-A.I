import "server-only";
import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import { commissionStatementLines, commissionStatements, salespeople } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope, isOwner } from "@/server/authz/guard";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { pageResult, pageWindow } from "@/server/pagination";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import { todayIn } from "@/server/targets/schemas";
import type { z } from "zod";
import { computeLines, parseKey } from "./calculate";
import { cancelSchema, paySchema, statementFiltersSchema, type StatementFilters, type StatementStatus } from "./schemas";

// Monthly commission statements: calculated (lines frozen) -> approved (by someone
// other than who calculated, except the owner) -> paid (final, with the reference of
// the payment made outside the system); calculated or approved -> cancelled.

const STATEMENT_NOT_FOUND = () => notFound("Apuração não encontrada.");
const LINE_CHUNK = 500;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

async function audit(tx: Tx, context: TenantContext, statement: { id: string; storeId: string }, action: string, changes: Record<string, unknown>) {
  await recordAudit(tx, {
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: `commission_statement.${action}`,
    entityType: "commission_statement",
    entityId: statement.id,
    storeId: statement.storeId,
    changes,
  });
}

export async function calculateStatement(context: TenantContext, rawKey: unknown): Promise<{ id: string }> {
  assertCan(context, "commissions.manage");
  const key = parseKey(rawKey);
  assertStoreInScope(context, key.storeId);
  if (key.month >= todayIn(context.organization.timezone).slice(0, 7)) throw invalid("Só meses encerrados podem ser apurados.");
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      await assertFeature(tx, orgId, "pos");
      const [salesperson] = await tx.select({ id: salespeople.id }).from(salespeople).where(and(eq(salespeople.organizationId, orgId), eq(salespeople.id, key.salespersonId)));
      if (!salesperson) throw notFound("Vendedor não encontrado.");
      const keyCondition = and(eq(commissionStatements.organizationId, orgId), eq(commissionStatements.salespersonId, key.salespersonId), eq(commissionStatements.storeId, key.storeId), eq(commissionStatements.month, key.month));
      const [current] = await tx
        .select({ id: commissionStatements.id, status: commissionStatements.status })
        .from(commissionStatements)
        .where(and(keyCondition, ne(commissionStatements.status, "cancelled")))
        .for("update");
      if (current && current.status !== "calculated") throw invalid("A apuração deste mês já foi aprovada ou paga. Cancele a aprovada antes de recalcular.");
      const now = new Date();
      if (current) {
        await tx
          .update(commissionStatements)
          .set({ status: "cancelled", cancelledBy: context.user.id, cancelledAt: now, cancelReason: "Recalculada", updatedAt: now })
          .where(and(eq(commissionStatements.organizationId, orgId), eq(commissionStatements.id, current.id)));
      }
      const result = await computeLines(tx, context, key);
      const [created] = await tx
        .insert(commissionStatements)
        .values({ organizationId: orgId, ...key, baseCents: result.baseCents, commissionCents: result.commissionCents, calculatedBy: context.user.id })
        .returning({ id: commissionStatements.id });
      for (let start = 0; start < result.lines.length; start += LINE_CHUNK) {
        await tx.insert(commissionStatementLines).values(result.lines.slice(start, start + LINE_CHUNK).map((line) => ({ ...line, organizationId: orgId, statementId: created.id })));
      }
      await audit(tx, context, { id: created.id, storeId: key.storeId }, "calculated", {
        salespersonId: key.salespersonId,
        month: key.month,
        baseCents: result.baseCents,
        commissionCents: result.commissionCents,
        lines: result.lines.length,
        replaced: current?.id ?? null,
      });
      return { id: created.id };
    });
  } catch (error) {
    if (isUniqueViolation(error, "commission_statements_active_key")) throw conflict("A apuração foi calculada ao mesmo tempo por outra pessoa. Tente de novo.");
    throw error;
  }
}

async function lockStatement(tx: Tx, context: TenantContext, statementId: string) {
  if (!isUuid(statementId)) throw STATEMENT_NOT_FOUND();
  const [row] = await tx
    .select({
      id: commissionStatements.id,
      storeId: commissionStatements.storeId,
      status: commissionStatements.status,
      month: commissionStatements.month,
      calculatedBy: commissionStatements.calculatedBy,
      commissionCents: commissionStatements.commissionCents,
    })
    .from(commissionStatements)
    .where(and(eq(commissionStatements.organizationId, context.organization.id), eq(commissionStatements.id, statementId), storeScopeCondition(context.storeScope, commissionStatements.storeId)))
    .for("update");
  if (!row) throw STATEMENT_NOT_FOUND();
  return row;
}

async function transition(context: TenantContext, statementId: string, from: StatementStatus[], to: StatementStatus, values: Partial<typeof commissionStatements.$inferInsert>, changes: Record<string, unknown>, check?: (row: Awaited<ReturnType<typeof lockStatement>>) => void) {
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const row = await lockStatement(tx, context, statementId);
    if (!from.includes(row.status)) throw invalid("Esta apuração não está na situação que permite esta ação.");
    check?.(row);
    await tx.update(commissionStatements).set({ ...values, status: to, updatedAt: new Date() }).where(and(eq(commissionStatements.organizationId, orgId), eq(commissionStatements.id, row.id)));
    await audit(tx, context, row, to, { month: row.month, commissionCents: row.commissionCents, ...changes });
  });
}

export async function approveStatement(context: TenantContext, statementId: string): Promise<void> {
  assertCan(context, "commissions.approve");
  await transition(context, statementId, ["calculated"], "approved", { approvedBy: context.user.id, approvedAt: new Date() }, {}, (row) => {
    // Segregation of duties: who calculated does not approve (the owner may).
    if (row.calculatedBy === context.user.id && !isOwner(context)) throw forbidden("Quem calculou a apuração não pode aprová-la.");
  });
}

export async function payStatement(context: TenantContext, statementId: string, rawInput: unknown): Promise<void> {
  assertCan(context, "commissions.pay");
  const { paymentReference } = parse(paySchema, rawInput);
  await transition(context, statementId, ["approved"], "paid", { paidBy: context.user.id, paidAt: new Date(), paymentReference }, { paymentReference });
}

export async function cancelStatement(context: TenantContext, statementId: string, rawInput: unknown): Promise<void> {
  assertCan(context, "commissions.manage");
  const { reason } = parse(cancelSchema, rawInput);
  await transition(context, statementId, ["calculated", "approved"], "cancelled", { cancelledBy: context.user.id, cancelledAt: new Date(), cancelReason: reason }, { reason });
}

export async function listStatements(context: TenantContext, rawFilters: StatementFilters) {
  assertCan(context, "commissions.read");
  const filters = statementFiltersSchema.parse(rawFilters);
  const where = and(
    eq(commissionStatements.organizationId, context.organization.id),
    eq(commissionStatements.month, filters.month),
    storeScopeCondition(context.storeScope, commissionStatements.storeId),
    filters.storeId ? eq(commissionStatements.storeId, filters.storeId) : undefined,
    filters.status ? eq(commissionStatements.status, filters.status) : undefined,
  );
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(commissionStatements).where(where);
    const rows = await tx
      .select({
        id: commissionStatements.id,
        salespersonId: commissionStatements.salespersonId,
        nickname: salespeople.nickname,
        storeId: commissionStatements.storeId,
        month: commissionStatements.month,
        status: commissionStatements.status,
        baseCents: commissionStatements.baseCents,
        commissionCents: commissionStatements.commissionCents,
        calculatedAt: commissionStatements.calculatedAt,
      })
      .from(commissionStatements)
      .innerJoin(salespeople, and(eq(salespeople.organizationId, commissionStatements.organizationId), eq(salespeople.id, commissionStatements.salespersonId)))
      .where(where)
      .orderBy(asc(salespeople.nickname), desc(commissionStatements.calculatedAt))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}

export async function getStatement(context: TenantContext, statementId: string) {
  assertCan(context, "commissions.read");
  if (!isUuid(statementId)) return null;
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const [statement] = await tx
      .select()
      .from(commissionStatements)
      .where(and(eq(commissionStatements.organizationId, orgId), eq(commissionStatements.id, statementId), storeScopeCondition(context.storeScope, commissionStatements.storeId)));
    if (!statement) return null;
    const lines = await tx.select().from(commissionStatementLines).where(and(eq(commissionStatementLines.organizationId, orgId), eq(commissionStatementLines.statementId, statementId)));
    return { ...statement, lines };
  });
}
