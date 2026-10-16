"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { invalidState, pick } from "@/server/forms";
import { STORE_FORM_FIELDS, storeInputSchema, storeStatusSchema } from "@/server/stores/schemas";
import { createStore, setStoreStatus, updateStore } from "@/server/stores/service";

const storeIdSchema = z.uuid();

export async function createStoreAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = storeInputSchema.safeParse(pick(formData, STORE_FORM_FIELDS));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      const created = await createStore(context, parsed.data);
      revalidatePath("/lojas");
      redirect(`/lojas/${created.id}?criada=1`);
    },
    "Loja cadastrada.",
    "createStore",
  );
}

export async function updateStoreAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = storeIdSchema.safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: "Loja inválida." };
  // A disabled region select is not submitted: `regionId` stays undefined and the region is kept.
  const parsed = storeInputSchema.safeParse(pick(formData, STORE_FORM_FIELDS));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      await updateStore(context, id.data, parsed.data);
      revalidatePath("/lojas");
      revalidatePath(`/lojas/${id.data}`);
      redirect(`/lojas/${id.data}?atualizada=1`);
    },
    "Loja atualizada.",
    "updateStore",
  );
}

export async function setStoreStatusAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = storeIdSchema.safeParse(formData.get("id"));
  const status = storeStatusSchema.safeParse(formData.get("status"));
  if (!id.success || !status.success) return { status: "error", message: "Solicitação inválida." };
  return runAction(
    async () => {
      await setStoreStatus(context, id.data, status.data);
      revalidatePath("/lojas");
      revalidatePath(`/lojas/${id.data}`);
    },
    status.data === "active" ? "Loja ativada." : "Loja desativada.",
    "setStoreStatus",
  );
}
