"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { invalidState, pick } from "@/server/forms";
import {
  changeOrganizationPlan,
  ORGANIZATION_STATUSES,
  requirePlatformAdmin,
  setOrganizationStatus,
} from "@/server/platform/service";

/** Success may carry warnings (downgrade below current usage), shown before the dialog closes. */
export interface PlanChangeState extends ActionState {
  warnings?: string[];
}

const organizationId = z.uuid({ error: "Empresa inválida." });

const planChangeSchema = z.object({
  organizationId,
  planKey: z.string({ error: "Selecione um plano." }).trim().min(1, { error: "Selecione um plano." }).max(32),
});

const statusChangeSchema = z.object({
  organizationId,
  status: z.enum(ORGANIZATION_STATUSES, { error: "Situação inválida." }),
});

export async function changeOrganizationPlanAction(_state: PlanChangeState, formData: FormData): Promise<PlanChangeState> {
  const admin = await requirePlatformAdmin();
  const parsed = planChangeSchema.safeParse(pick(formData, ["organizationId", "planKey"]));
  if (!parsed.success) return invalidState(parsed.error);
  let warnings: string[] = [];
  const state = await runAction(
    async () => {
      const result = await changeOrganizationPlan(admin.userId, parsed.data.organizationId, parsed.data.planKey);
      warnings = result.warnings;
      revalidatePath("/plataforma");
    },
    "Plano alterado.",
    "changeOrganizationPlan",
  );
  return state.status === "success" ? { ...state, warnings } : state;
}

export async function setOrganizationStatusAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requirePlatformAdmin();
  const parsed = statusChangeSchema.safeParse(pick(formData, ["organizationId", "status"]));
  if (!parsed.success) return { status: "error", message: "Não foi possível identificar a empresa ou a situação." };
  return runAction(
    async () => {
      await setOrganizationStatus(admin.userId, parsed.data.organizationId, parsed.data.status);
      revalidatePath("/plataforma");
    },
    parsed.data.status === "suspended" ? "Empresa suspensa." : "Empresa reativada.",
    "setOrganizationStatus",
  );
}
