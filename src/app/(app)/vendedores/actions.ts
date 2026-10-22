"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { invalidState, pick, pickAll } from "@/server/forms";
import { salespersonSchema, scheduleSchema } from "@/server/salespeople/schemas";
import { saveSalesperson, setSalespersonActive } from "@/server/salespeople/service";
import { setSchedule } from "@/server/salespeople/schedules";

const idSchema = z.uuid({ error: "Vendedor inválido." });

function salespersonInput(formData: FormData) {
  return salespersonSchema.safeParse({
    ...pick(formData, ["membershipId", "code", "nickname"]),
    storeIds: pickAll(formData, "storeIds"),
  });
}

export async function saveSalespersonAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "members.read") || !can(context, "stores.read") || !can(context, "salespeople.manage")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const input = salespersonInput(formData);
  if (!input.success) return invalidState(input.error);
  const rawId = formData.get("id");
  const id = rawId === null ? undefined : idSchema.safeParse(rawId);
  if (id && !id.success) return { status: "error", message: "Vendedor inválido." };
  return runAction(async () => {
    await saveSalesperson(context, input.data, id?.data);
    revalidatePath("/vendedores");
  }, "Vendedor salvo.", "saveSalesperson");
}

export async function setSalespersonActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = idSchema.safeParse(formData.get("id"));
  const active = z.enum(["true", "false"]).safeParse(formData.get("active"));
  if (!id.success || !active.success) return { status: "error", message: "Solicitação inválida." };
  return runAction(async () => {
    await setSalespersonActive(context, id.data, active.data === "true");
    revalidatePath("/vendedores");
  }, "Situação atualizada.", "setSalespersonActive");
}

export async function setScheduleAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = scheduleSchema.safeParse({
    ...pick(formData, ["salespersonId", "storeId", "month"]),
    daysOff: pickAll(formData, "daysOff"),
  });
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(async () => {
    await setSchedule(context, parsed.data);
    revalidatePath("/vendedores");
  }, "Escala salva.", "setSalespersonSchedule");
}

