"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { parseBrlToCents } from "@/lib/money";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { fieldErrorsOf, invalidState, pick } from "@/server/forms";
import { targetInputSchema } from "@/server/targets/schemas";
import { setTarget } from "@/server/targets/service";

export async function setTargetAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  if (!can(context, "targets.manage")) return { status: "error", message: "Você não tem permissão para esta ação." };
  const amountReais = formData.get("amountReais");
  const cents = typeof amountReais === "string" ? parseBrlToCents(amountReais) : null;
  if (cents === null) return { status: "error", message: "Revise os campos destacados.", fieldErrors: { amountReais: ["Informe um valor em reais válido, com até duas casas decimais."] } };
  const input = targetInputSchema.safeParse({ ...pick(formData, ["scope", "regionId", "storeId", "salespersonId", "month", "reason"]), amountCents: cents });
  if (!input.success) {
    const fieldErrors = fieldErrorsOf(input.error);
    if (fieldErrors.amountCents) {
      fieldErrors.amountReais = fieldErrors.amountCents;
      delete fieldErrors.amountCents;
    }
    return { status: "error", message: "Revise os campos destacados.", fieldErrors };
  }
  return runAction(async () => {
    await setTarget(context, input.data);
    revalidatePath("/metas");
  }, "Meta salva.", "setSalesTarget");
}
