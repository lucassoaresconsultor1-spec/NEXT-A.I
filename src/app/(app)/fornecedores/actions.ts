"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import {
  createSupplier,
  setSupplierActive,
  updateSupplier,
} from "@/server/catalog/references";
import { supplierInputSchema } from "@/server/catalog/schemas";
import { invalidState, pick } from "@/server/forms";

const INVALID = { status: "error", message: "Fornecedor inválido." } as const satisfies ActionState;

const optionalId = z.union([z.literal(""), z.uuid()]).optional();
const statusSchema = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) });

export async function saveSupplierAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = optionalId.safeParse(formData.get("id") ?? undefined);
  if (!id.success) return INVALID;
  const parsed = supplierInputSchema.safeParse(pick(formData, ["name", "document", "email", "phone"]));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      if (id.data) await updateSupplier(context, id.data, parsed.data);
      else await createSupplier(context, parsed.data);
      revalidatePath("/fornecedores");
    },
    id.data ? "Fornecedor atualizado." : "Fornecedor cadastrado.",
    "saveSupplier",
  );
}

export async function setSupplierActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = statusSchema.safeParse(pick(formData, ["id", "active"]));
  if (!parsed.success) return INVALID;
  const active = parsed.data.active === "true";
  return runAction(
    async () => {
      await setSupplierActive(context, parsed.data.id, active);
      revalidatePath("/fornecedores");
    },
    active ? "Fornecedor ativado." : "Fornecedor desativado.",
    "setSupplierActive",
  );
}
