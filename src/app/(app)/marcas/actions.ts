"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import {
  createReference,
  setReferenceActive,
  updateReference,
} from "@/server/catalog/references";
import { referenceInputSchema } from "@/server/catalog/schemas";
import { invalidState, pick } from "@/server/forms";

const INVALID = { status: "error", message: "Marca inválida." } as const satisfies ActionState;

const optionalId = z.union([z.literal(""), z.uuid()]).optional();
const statusSchema = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) });

export async function saveBrandAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = optionalId.safeParse(formData.get("id") ?? undefined);
  if (!id.success) return INVALID;
  const parsed = referenceInputSchema.safeParse(pick(formData, ["name"]));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      if (id.data) await updateReference(context, "brand", id.data, parsed.data);
      else await createReference(context, "brand", parsed.data);
      revalidatePath("/marcas");
    },
    id.data ? "Marca atualizada." : "Marca cadastrada.",
    "saveBrand",
  );
}

export async function setBrandActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = statusSchema.safeParse(pick(formData, ["id", "active"]));
  if (!parsed.success) return INVALID;
  const active = parsed.data.active === "true";
  return runAction(
    async () => {
      await setReferenceActive(context, "brand", parsed.data.id, active);
      revalidatePath("/marcas");
    },
    active ? "Marca ativada." : "Marca desativada.",
    "setBrandActive",
  );
}
