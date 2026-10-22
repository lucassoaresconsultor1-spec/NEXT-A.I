"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { invalidState, pick } from "@/server/forms";
import { parseBrlToCents } from "@/lib/money";
import {
  createExpense,
  updateExpense,
  payExpense,
  cancelExpense,
  saveCategory,
  setCategoryActive,
} from "@/server/expenses/service";
import { expenseSchema, paySchema, cancelSchema, categorySchema } from "@/server/expenses/schemas";

const idSchema = z.uuid({ error: "Despesa inválida." });
const categoryIdSchema = z.uuid({ error: "Categoria inválida." });

function parseAmount(formData: FormData): number | null {
  return parseBrlToCents(String(formData.get("amountReais") ?? ""));
}

export async function saveExpenseAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "expenses.manage")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const amountCents = parseAmount(formData);
  if (amountCents === null) {
    return { status: "error", message: "Revise os campos destacados.", fieldErrors: { amountReais: ["Informe um valor em reais válido, com até duas casas decimais."] } };
  }
  const parsed = expenseSchema.safeParse(pick(formData, ["storeId", "categoryId", "competenceDate", "description", "dueDate"]));
  if (!parsed.success) return invalidState(parsed.error);
  const input = { ...parsed.data, amountCents };
  const id = idSchema.safeParse(formData.get("id"));
  let result: ActionState;
  if (id.success && id.data) {
    result = await runAction(async () => {
      await updateExpense(context, id.data, input);
      revalidatePath("/despesas");
    }, "Despesa atualizada.", "updateExpense");
  } else {
    result = await runAction(async () => {
      await createExpense(context, input);
      revalidatePath("/despesas");
    }, "Despesa criada.", "createExpense");
  }
  return result;
}

export async function payExpenseAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "expenses.manage")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = paySchema.safeParse(pick(formData, ["paidOn"]));
  if (!id.success) return { status: "error", message: "Despesa inválida." };
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(async () => {
    await payExpense(context, id.data, parsed.data);
    revalidatePath("/despesas");
  }, "Despesa paga.", "payExpense");
}

export async function cancelExpenseAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "expenses.manage")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = cancelSchema.safeParse(pick(formData, ["reason"]));
  if (!id.success) return { status: "error", message: "Despesa inválida." };
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(async () => {
    await cancelExpense(context, id.data, parsed.data);
    revalidatePath("/despesas");
  }, "Despesa cancelada.", "cancelExpense");
}

export async function saveCategoryAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "expenses.manage")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const parsed = categorySchema.safeParse(pick(formData, ["name"]));
  if (!parsed.success) return invalidState(parsed.error);
  const id = categoryIdSchema.safeParse(formData.get("id"));
  let result: ActionState;
  if (id.success && id.data) {
    result = await runAction(async () => {
      await saveCategory(context, parsed.data, id.data);
      revalidatePath("/despesas/categorias");
    }, "Categoria atualizada.", "updateExpenseCategory");
  } else {
    result = await runAction(async () => {
      await saveCategory(context, parsed.data);
      revalidatePath("/despesas/categorias");
    }, "Categoria criada.", "createExpenseCategory");
  }
  return result;
}

export async function setCategoryActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "expenses.manage")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const parsed = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).safeParse(pick(formData, ["id", "active"]));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(async () => {
    await setCategoryActive(context, parsed.data.id, parsed.data.active === "true");
    revalidatePath("/despesas/categorias");
  }, parsed.data.active === "true" ? "Categoria ativada." : "Categoria desativada.", "setExpenseCategoryActive");
}
