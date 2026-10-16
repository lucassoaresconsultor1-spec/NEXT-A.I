"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import {
  createDepartment,
  deleteDepartment,
  departmentInputSchema,
  setDepartmentActive,
  updateDepartment,
} from "@/server/departments/service";
import { invalidState, pick } from "@/server/forms";

const INVALID = { status: "error", message: "Departamento inválido." } as const satisfies ActionState;

const optionalId = z.union([z.literal(""), z.uuid()]).optional();
const statusSchema = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) });

// The painel shows the active department count, so it is refreshed together with the list.
function revalidateDepartments() {
  revalidatePath("/departamentos");
  revalidatePath("/painel");
}

export async function saveDepartmentAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = optionalId.safeParse(formData.get("id") ?? undefined);
  if (!id.success) return INVALID;
  const parsed = departmentInputSchema.safeParse(pick(formData, ["name", "description"]));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      if (id.data) await updateDepartment(context, id.data, parsed.data);
      else await createDepartment(context, parsed.data);
      revalidateDepartments();
    },
    id.data ? "Departamento atualizado." : "Departamento cadastrado.",
    "saveDepartment",
  );
}

export async function setDepartmentActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = statusSchema.safeParse(pick(formData, ["id", "active"]));
  if (!parsed.success) return INVALID;
  const active = parsed.data.active === "true";
  return runAction(
    async () => {
      await setDepartmentActive(context, parsed.data.id, active);
      revalidateDepartments();
    },
    active ? "Departamento ativado." : "Departamento desativado.",
    "setDepartmentActive",
  );
}

export async function deleteDepartmentAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return INVALID;
  return runAction(
    async () => {
      await deleteDepartment(context, id.data);
      revalidateDepartments();
    },
    "Departamento excluído.",
    "deleteDepartment",
  );
}
