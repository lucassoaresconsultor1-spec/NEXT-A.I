"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { invalidState, pick, pickAll } from "@/server/forms";
import {
  ADD_MEMBER_FIELDS,
  addMemberSchema,
  MEMBER_ACCESS_FIELDS,
  memberAccessSchema,
  memberStatusInputSchema,
  temporaryPasswordSchema,
} from "@/server/members/schemas";
import { addMember, removeMember, resetMemberPassword, setMemberStatus, updateMemberAccess } from "@/server/members/service";

const INVALID_MEMBER: ActionState = { status: "error", message: "Membro inválido." };
const membershipId = z.uuid();

function scopeLists(formData: FormData) {
  return { regionIds: pickAll(formData, "regionIds"), storeIds: pickAll(formData, "storeIds") };
}

function revalidateMember(id: string) {
  revalidatePath("/equipe");
  revalidatePath(`/equipe/${id}`);
}

export async function addMemberAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = addMemberSchema.safeParse({ ...pick(formData, ADD_MEMBER_FIELDS), ...scopeLists(formData) });
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      const result = await addMember(context, parsed.data);
      revalidatePath("/equipe");
      redirect(`/equipe/${result.membershipId}?adicionado=${result.linkedExistingUser ? "vinculado" : "novo"}`);
    },
    "Membro adicionado.",
    "addMember",
  );
}

export async function updateMemberAccessAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = membershipId.safeParse(formData.get("id"));
  if (!id.success) return INVALID_MEMBER;
  const parsed = memberAccessSchema.safeParse({ ...pick(formData, MEMBER_ACCESS_FIELDS), ...scopeLists(formData) });
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      await updateMemberAccess(context, id.data, parsed.data);
      revalidateMember(id.data);
    },
    "Acesso atualizado.",
    "updateMemberAccess",
  );
}

export async function setMemberStatusAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = membershipId.safeParse(formData.get("id"));
  const parsed = memberStatusInputSchema.safeParse(pick(formData, ["status"]));
  if (!id.success || !parsed.success) return INVALID_MEMBER;
  return runAction(
    async () => {
      await setMemberStatus(context, id.data, parsed.data.status);
      revalidateMember(id.data);
    },
    parsed.data.status === "active" ? "Acesso reativado." : "Acesso suspenso.",
    "setMemberStatus",
  );
}

export async function removeMemberAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = membershipId.safeParse(formData.get("id"));
  if (!id.success) return INVALID_MEMBER;
  return runAction(
    async () => {
      await removeMember(context, id.data);
      revalidatePath("/equipe");
      redirect("/equipe?removido=1");
    },
    "Membro removido da equipe.",
    "removeMember",
  );
}

export async function resetMemberPasswordAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = membershipId.safeParse(formData.get("id"));
  if (!id.success) return INVALID_MEMBER;
  const parsed = temporaryPasswordSchema.safeParse(pick(formData, ["temporaryPassword"]));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      await resetMemberPassword(context, id.data, parsed.data.temporaryPassword);
      revalidateMember(id.data);
    },
    "Senha provisória definida. Informe-a à pessoa por um canal seguro; ela deverá trocá-la no próximo acesso.",
    "resetMemberPassword",
  );
}
