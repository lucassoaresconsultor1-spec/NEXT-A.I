"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { pick } from "@/server/forms";
import { updateOrganizationOperations, updateStoreOperations } from "@/server/settings/service";

// The service validates the raw fields (percent strings, receipt texts) and
// returns field errors, so the actions only pick the expected keys.

export async function saveOrganizationOperationsAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const input = pick(formData, ["customerRequirement", "maxDiscountBps", "receiptHeader", "receiptFooter"]);
  return runAction(
    async () => {
      await updateOrganizationOperations(context, input);
      revalidatePath("/configuracoes/operacao");
    },
    "Regras da empresa salvas.",
    "saveOrganizationOperations",
  );
}

export async function saveStoreOperationsAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const storeId = formData.get("storeId");
  const input = pick(formData, ["customerRequirement", "maxDiscountBps", "receiptHeader"]);
  return runAction(
    async () => {
      await updateStoreOperations(context, typeof storeId === "string" ? storeId : "", input);
      revalidatePath("/configuracoes/operacao");
    },
    "Regras da loja salvas.",
    "saveStoreOperations",
  );
}
