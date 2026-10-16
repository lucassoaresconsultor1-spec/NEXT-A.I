"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { invalidState, pick } from "@/server/forms";
import { createRegion, deleteRegion, regionInputSchema, updateRegion } from "@/server/regions/service";

const optionalId = z.union([z.literal(""), z.uuid()]).optional();

export async function saveRegionAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = optionalId.safeParse(formData.get("id") ?? undefined);
  const parsed = regionInputSchema.safeParse(pick(formData, ["name", "description"]));
  if (!id.success || !parsed.success) return parsed.success ? { status: "error", message: "Região inválida." } : invalidState(parsed.error);
  return runAction(
    async () => {
      if (id.data) await updateRegion(context, id.data, parsed.data);
      else await createRegion(context, parsed.data);
      revalidatePath("/regioes");
    },
    id.data ? "Região atualizada." : "Região cadastrada.",
    "saveRegion",
  );
}

export async function deleteRegionAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: "Região inválida." };
  return runAction(
    async () => {
      await deleteRegion(context, id.data);
      revalidatePath("/regioes");
    },
    "Região excluída.",
    "deleteRegion",
  );
}
