"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { invalidState, pick, pickAll } from "@/server/forms";
import { ROLE_FORM_FIELDS, roleInputSchema } from "@/server/roles/schemas";
import { createRole, deleteRole, updateRole } from "@/server/roles/service";

const roleIdSchema = z.uuid();

function parseRoleForm(formData: FormData) {
  return roleInputSchema.safeParse({ ...pick(formData, ROLE_FORM_FIELDS), permissions: pickAll(formData, "permissions") });
}

function revalidateRoles(roleId?: string) {
  revalidatePath("/perfis");
  if (roleId) revalidatePath(`/perfis/${roleId}`);
  // Member lists show role names.
  revalidatePath("/equipe");
}

export async function createRoleAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = parseRoleForm(formData);
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      const created = await createRole(context, parsed.data);
      revalidateRoles();
      redirect(`/perfis/${created.id}?criado=1`);
    },
    "Perfil criado.",
    "createRole",
  );
}

export async function updateRoleAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = roleIdSchema.safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: "Perfil inválido." };
  const parsed = parseRoleForm(formData);
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      await updateRole(context, id.data, parsed.data);
      revalidateRoles(id.data);
    },
    "Alterações salvas. Membros com este perfil recebem as novas permissões na próxima ação.",
    "updateRole",
  );
}

export async function deleteRoleAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = roleIdSchema.safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: "Perfil inválido." };
  return runAction(
    async () => {
      await deleteRole(context, id.data);
      revalidateRoles(id.data);
      redirect("/perfis?excluido=1");
    },
    "Perfil excluído.",
    "deleteRole",
  );
}
