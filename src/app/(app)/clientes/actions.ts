"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { createCustomer, setCustomerActive, updateCustomer } from "@/server/customers/service";
import { pick } from "@/server/forms";

const INVALID = { status: "error", message: "Cliente inválido." } as const satisfies ActionState;
const FIELDS = ["name", "document", "email", "phone", "marketingConsent"] as const;

const optionalId = z.union([z.literal(""), z.uuid()]).optional();
const statusSchema = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) });

// The customer service validates the raw fields, masks the CPF and keeps it when
// the mask is sent back; the actions only pick the expected keys.

export async function saveCustomerAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = optionalId.safeParse(formData.get("id") ?? undefined);
  if (!id.success) return INVALID;
  const input = pick(formData, FIELDS);
  return runAction(
    async () => {
      if (id.data) await updateCustomer(context, id.data, input);
      else await createCustomer(context, input);
      revalidatePath("/clientes");
    },
    id.data ? "Cliente atualizado." : "Cliente cadastrado.",
    "saveCustomer",
  );
}

export async function setCustomerActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = statusSchema.safeParse(pick(formData, ["id", "active"]));
  if (!parsed.success) return INVALID;
  const active = parsed.data.active === "true";
  return runAction(
    async () => {
      await setCustomerActive(context, parsed.data.id, active);
      revalidatePath("/clientes");
    },
    active ? "Cliente ativado." : "Cliente desativado.",
    "setCustomerActive",
  );
}
