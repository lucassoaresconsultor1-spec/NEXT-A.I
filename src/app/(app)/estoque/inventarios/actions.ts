"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { pick } from "@/server/forms";
import { approveCount, cancelCount, openCount, recordCountedQuantities } from "@/server/inventory/counts";
import { itemFieldErrors, readCountedItems } from "./count-form-data";

const INVALID = { status: "error", message: "Inventário inválido." } as const satisfies ActionState;
const idSchema = z.uuid();

function revalidateCount(countId?: string) {
  revalidatePath("/estoque/inventarios");
  if (countId) revalidatePath(`/estoque/inventarios/${countId}`);
}

// The count service validates every field; the actions only pick the expected keys.

export async function openCountAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  let createdId: string | undefined;
  const state = await runAction(
    async () => {
      createdId = (await openCount(context, pick(formData, ["storeId", "categoryId", "brandId", "note"]))).id;
      revalidateCount();
    },
    "Inventário aberto.",
    "openCount",
  );
  if (createdId) redirect(`/estoque/inventarios/${createdId}`);
  return state;
}

export async function recordCountAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const countId = idSchema.safeParse(formData.get("countId"));
  if (!countId.success) return INVALID;
  const items = readCountedItems(formData);
  if (items.length === 0) return { status: "error", message: "Digite ao menos uma quantidade contada." };
  const state = await runAction(
    async () => {
      await recordCountedQuantities(context, countId.data, { items });
      revalidateCount(countId.data);
    },
    items.length === 1 ? "1 quantidade registrada." : `${items.length} quantidades registradas.`,
    "recordCount",
  );
  return state.status === "error" ? { ...state, fieldErrors: itemFieldErrors(state.fieldErrors, items) } : state;
}

async function reasonAction(formData: FormData, work: (context: Awaited<ReturnType<typeof requireTenantContext>>, countId: string, input: unknown) => Promise<unknown>, message: string, name: string) {
  const context = await requireTenantContext();
  const countId = idSchema.safeParse(formData.get("countId"));
  if (!countId.success) return INVALID;
  return runAction(
    async () => {
      await work(context, countId.data, pick(formData, ["reason"]));
      revalidateCount(countId.data);
      revalidatePath("/estoque");
      revalidatePath("/estoque/movimentacoes");
    },
    message,
    name,
  );
}

export async function approveCountAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return reasonAction(formData, approveCount, "Inventário aprovado. O estoque foi ajustado.", "approveCount");
}

export async function cancelCountAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return reasonAction(formData, cancelCount, "Inventário cancelado.", "cancelCount");
}
