import "server-only";
import { and, asc, between, count, desc, eq, inArray, ne, sql, sum } from "drizzle-orm";
import type { z } from "zod";
import { expenseCategories, expenses, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope } from "@/server/authz/guard";
import { conflict, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { pageResult, pageWindow } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";
import { cancelSchema, categorySchema, expenseFiltersSchema, expenseSchema, paySchema, type ExpenseFilters } from "./schemas";

// Store expenses (m36a): categories, expenses by competence date, payment and
// cancellation (never deleted). sumExpensesInTx feeds the profit of m16b.

const EXPENSE_NOT_FOUND = () => notFound("Despesa não encontrada.");

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

async function audit(tx: Tx, context: TenantContext, action: string, entityType: string, entityId: string, storeId: string | null, changes: Record<string, unknown>) {
  await recordAudit(tx, { organizationId: context.organization.id, actorUserId: context.user.id, action, entityType, entityId, storeId, changes });
}

export async function listCategories(context: TenantContext) {
  assertCan(context, "expenses.read");
  return withScope(dbScope(context), (tx) =>
    tx
      .select({ id: expenseCategories.id, name: expenseCategories.name, isActive: expenseCategories.isActive })
      .from(expenseCategories)
      .where(eq(expenseCategories.organizationId, context.organization.id))
      .orderBy(asc(sql`lower(${expenseCategories.name})`)),
  );
}

export async function saveCategory(context: TenantContext, rawInput: unknown, categoryId?: string): Promise<{ id: string }> {
  assertCan(context, "expenses.manage");
  const { name } = parse(categorySchema, rawInput);
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      if (categoryId === undefined) {
        const [created] = await tx.insert(expenseCategories).values({ organizationId: orgId, name }).returning({ id: expenseCategories.id });
        await audit(tx, context, "expense_category.saved", "expense_category", created.id, null, { name });
        return { id: created.id };
      }
      if (!isUuid(categoryId)) throw notFound("Categoria não encontrada.");
      const [updated] = await tx
        .update(expenseCategories)
        .set({ name, updatedAt: new Date() })
        .where(and(eq(expenseCategories.organizationId, orgId), eq(expenseCategories.id, categoryId)))
        .returning({ id: expenseCategories.id });
      if (!updated) throw notFound("Categoria não encontrada.");
      await audit(tx, context, "expense_category.saved", "expense_category", updated.id, null, { name });
      return { id: updated.id };
    });
  } catch (error) {
    if (isUniqueViolation(error, "expense_categories_org_name_idx")) throw conflict("Já existe uma categoria com este nome.", { name: ["Já existe uma categoria com este nome."] });
    throw error;
  }
}

export async function setCategoryActive(context: TenantContext, categoryId: string, isActive: boolean): Promise<void> {
  assertCan(context, "expenses.manage");
  if (!isUuid(categoryId)) throw notFound("Categoria não encontrada.");
  await withScope(dbScope(context), async (tx) => {
    const [updated] = await tx
      .update(expenseCategories)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(expenseCategories.organizationId, context.organization.id), eq(expenseCategories.id, categoryId)))
      .returning({ id: expenseCategories.id });
    if (!updated) throw notFound("Categoria não encontrada.");
    await audit(tx, context, "expense_category.status_changed", "expense_category", updated.id, null, { isActive });
  });
}

async function assertUsable(tx: Tx, organizationId: string, storeId: string, categoryId: string) {
  const [store] = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, organizationId), eq(stores.id, storeId)));
  if (!store) throw notFound("Loja não encontrada.");
  const [category] = await tx.select({ isActive: expenseCategories.isActive }).from(expenseCategories).where(and(eq(expenseCategories.organizationId, organizationId), eq(expenseCategories.id, categoryId)));
  if (!category?.isActive) throw invalid("Revise os campos destacados.", { categoryId: ["Escolha uma categoria ativa."] });
}

export async function createExpense(context: TenantContext, rawInput: unknown): Promise<{ id: string }> {
  assertCan(context, "expenses.manage");
  const input = parse(expenseSchema, rawInput);
  assertStoreInScope(context, input.storeId);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertUsable(tx, orgId, input.storeId, input.categoryId);
    const [created] = await tx.insert(expenses).values({ organizationId: orgId, ...input, dueDate: input.dueDate ?? null, createdBy: context.user.id }).returning({ id: expenses.id });
    await audit(tx, context, "expense.created", "expense", created.id, input.storeId, input);
    return { id: created.id };
  });
}

async function lockExpense(tx: Tx, context: TenantContext, expenseId: string) {
  if (!isUuid(expenseId)) throw EXPENSE_NOT_FOUND();
  const [row] = await tx
    .select({ id: expenses.id, storeId: expenses.storeId, status: expenses.status, amountCents: expenses.amountCents })
    .from(expenses)
    .where(and(eq(expenses.organizationId, context.organization.id), eq(expenses.id, expenseId), storeScopeCondition(context.storeScope, expenses.storeId)))
    .for("update");
  if (!row) throw EXPENSE_NOT_FOUND();
  return row;
}

export async function updateExpense(context: TenantContext, expenseId: string, rawInput: unknown): Promise<void> {
  assertCan(context, "expenses.manage");
  const input = parse(expenseSchema, rawInput);
  assertStoreInScope(context, input.storeId);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const current = await lockExpense(tx, context, expenseId);
    if (current.status !== "open") throw invalid("Só despesas em aberto podem ser alteradas.");
    await assertUsable(tx, orgId, input.storeId, input.categoryId);
    await tx.update(expenses).set({ ...input, dueDate: input.dueDate ?? null, updatedAt: new Date() }).where(and(eq(expenses.organizationId, orgId), eq(expenses.id, current.id)));
    await audit(tx, context, "expense.updated", "expense", current.id, input.storeId, { ...input, previousCents: current.amountCents });
  });
}

export async function payExpense(context: TenantContext, expenseId: string, rawInput: unknown): Promise<void> {
  assertCan(context, "expenses.manage");
  const { paidOn } = parse(paySchema, rawInput);
  await withScope(dbScope(context), async (tx) => {
    const current = await lockExpense(tx, context, expenseId);
    if (current.status !== "open") throw invalid("Só despesas em aberto podem ser pagas.");
    await tx.update(expenses).set({ status: "paid", paidOn, updatedAt: new Date() }).where(and(eq(expenses.organizationId, context.organization.id), eq(expenses.id, current.id)));
    await audit(tx, context, "expense.paid", "expense", current.id, current.storeId, { paidOn, amountCents: current.amountCents });
  });
}

export async function cancelExpense(context: TenantContext, expenseId: string, rawInput: unknown): Promise<void> {
  assertCan(context, "expenses.manage");
  const { reason } = parse(cancelSchema, rawInput);
  await withScope(dbScope(context), async (tx) => {
    const current = await lockExpense(tx, context, expenseId);
    if (current.status === "cancelled") throw invalid("Esta despesa já foi cancelada.");
    await tx.update(expenses).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() }).where(and(eq(expenses.organizationId, context.organization.id), eq(expenses.id, current.id)));
    await audit(tx, context, "expense.cancelled", "expense", current.id, current.storeId, { reason, amountCents: current.amountCents });
  });
}

/** Expenses by competence date in the period, with the total of the filtered (not cancelled) ones. */
export async function listExpenses(context: TenantContext, rawFilters: ExpenseFilters) {
  assertCan(context, "expenses.read");
  const filters = expenseFiltersSchema.parse(rawFilters);
  const where = and(
    eq(expenses.organizationId, context.organization.id),
    storeScopeCondition(context.storeScope, expenses.storeId),
    between(expenses.competenceDate, filters.from, filters.to),
    filters.storeId ? eq(expenses.storeId, filters.storeId) : undefined,
    filters.categoryId ? eq(expenses.categoryId, filters.categoryId) : undefined,
    filters.status ? eq(expenses.status, filters.status) : undefined,
  );
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(expenses).where(where);
    const [amount] = await tx.select({ value: sum(expenses.amountCents).mapWith(Number) }).from(expenses).where(and(where, ne(expenses.status, "cancelled")));
    const rows = await tx
      .select({
        id: expenses.id,
        storeId: expenses.storeId,
        storeName: stores.name,
        categoryId: expenses.categoryId,
        categoryName: expenseCategories.name,
        competenceDate: expenses.competenceDate,
        description: expenses.description,
        amountCents: expenses.amountCents,
        dueDate: expenses.dueDate,
        status: expenses.status,
        paidOn: expenses.paidOn,
      })
      .from(expenses)
      .innerJoin(stores, and(eq(stores.organizationId, expenses.organizationId), eq(stores.id, expenses.storeId)))
      .innerJoin(expenseCategories, and(eq(expenseCategories.organizationId, expenses.organizationId), eq(expenseCategories.id, expenses.categoryId)))
      .where(where)
      .orderBy(desc(expenses.competenceDate), desc(expenses.createdAt))
      .limit(limit)
      .offset(offset);
    return { ...pageResult(rows, total.value, filters.page), totalCents: amount?.value ?? 0 };
  });
}

/** Σ of the not cancelled expenses by competence date (for profit in m16b); the caller authorizes the stores. */
export async function sumExpensesInTx(tx: Tx, organizationId: string, filters: { from: string; to: string; storeIds?: string[] }): Promise<number> {
  const [row] = await tx
    .select({ value: sum(expenses.amountCents).mapWith(Number) })
    .from(expenses)
    .where(
      and(
        eq(expenses.organizationId, organizationId),
        ne(expenses.status, "cancelled"),
        between(expenses.competenceDate, filters.from, filters.to),
        filters.storeIds ? inArray(expenses.storeId, filters.storeIds) : undefined,
      ),
    );
  return row?.value ?? 0;
}
