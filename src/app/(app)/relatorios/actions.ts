"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { invalidState, pick } from "@/server/forms";
import { runReport, getRunCsv } from "@/server/reports/service";
import { reportParamsSchema } from "@/server/reports/service";

const idSchema = z.uuid({ error: "Relatório inválido." });

export async function generateReportAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "reports.read")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const parsed = reportParamsSchema.safeParse(pick(formData, ["kind", "from", "to", "storeId", "groupBy"]));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(async () => {
    await runReport(context, parsed.data);
    revalidatePath("/relatorios");
  }, "Relatório gerado.", "generateReport");
}

export async function downloadReportAction(_state: ActionState, formData: FormData): Promise<ActionState & { fileName?: string; content?: string }> {
  const context = await requireTenantContext();
  if (!can(context, "reports.read")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: "Relatório inválido." };
  let result: { fileName: string; content: string } | null = null;
  const state = await runAction(async () => {
    result = await getRunCsv(context, id.data);
    revalidatePath("/relatorios");
  }, "Relatório baixado.", "downloadReport");
  return { ...state, ...(state.status === "success" && result ? result : {}) };
}

