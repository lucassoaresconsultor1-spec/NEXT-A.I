"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { invalidState, pick } from "@/server/forms";
import { createRule } from "@/server/commissions/rules";
import { calculateStatement, approveStatement, payStatement, cancelStatement } from "@/server/commissions/statements";
import { estimateCommission } from "@/server/commissions/calculate";
import { ruleInputSchema, statementKeySchema, paySchema, cancelSchema } from "@/server/commissions/schemas";

const idSchema = z.uuid({ error: "Apuração inválida." });

export async function createRuleAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "commissions.manage")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const input = ruleInputSchema.safeParse(pick(formData, ["storeId", "effectiveFrom", "defaultRateBps", "categoryRates", "reason"]));
  if (!input.success) return invalidState(input.error);
  return runAction(async () => {
    await createRule(context, input.data);
    revalidatePath("/comissoes");
  }, "Regra de comissão criada.", "createCommissionRule");
}

export async function calculateStatementAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "commissions.manage")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const parsed = statementKeySchema.safeParse(pick(formData, ["salespersonId", "storeId", "month"]));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(async () => {
    await calculateStatement(context, parsed.data);
    revalidatePath("/comissoes");
  }, "Apuração calculada.", "calculateCommissionStatement");
}

export async function approveStatementAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "commissions.approve")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: "Apuração inválida." };
  return runAction(async () => {
    await approveStatement(context, id.data);
    revalidatePath("/comissoes");
  }, "Apuração aprovada.", "approveCommissionStatement");
}

export async function payStatementAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "commissions.pay")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = paySchema.safeParse(pick(formData, ["paymentReference"]));
  if (!id.success) return { status: "error", message: "Apuração inválida." };
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(async () => {
    await payStatement(context, id.data, parsed.data);
    revalidatePath("/comissoes");
  }, "Pagamento registrado.", "payCommissionStatement");
}

export async function cancelStatementAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "commissions.manage")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = cancelSchema.safeParse(pick(formData, ["reason"]));
  if (!id.success) return { status: "error", message: "Apuração inválida." };
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(async () => {
    await cancelStatement(context, id.data, parsed.data);
    revalidatePath("/comissoes");
  }, "Apuração cancelada.", "cancelCommissionStatement");
}

export async function estimateCommissionAction(_state: ActionState, formData: FormData): Promise<ActionState & { baseCents?: number; commissionCents?: number }> {
  const context = await requireTenantContext();
  if (!can(context, "commissions.read")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const parsed = statementKeySchema.safeParse(pick(formData, ["salespersonId", "storeId", "month"]));
  if (!parsed.success) return invalidState(parsed.error);
  let result: { baseCents: number; commissionCents: number } | undefined;
  const state = await runAction(async () => {
    result = await estimateCommission(context, parsed.data);
  }, "Estimativa calculada.", "estimateCommission");
  return { ...state, ...(state.status === "success" && result ? result : {}) };
}
