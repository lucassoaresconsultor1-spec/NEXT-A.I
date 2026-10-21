"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { pick } from "@/server/forms";
import { recordMovement, type MovementInput } from "@/server/inventory/service";

const FIELDS = ["storeId", "variantId", "type", "quantity", "reason"] as const;

/** The stock service validates the fields (movementInputSchema) and reports errors per field. */
export async function recordMovementAction(_state: ActionState, formData: FormData): Promise<ActionState & { balanceAfter?: string }> {
  const context = await requireTenantContext();
  const raw = pick(formData, FIELDS);
  const text = (field: (typeof FIELDS)[number]) => (typeof raw[field] === "string" ? raw[field] : "");
  const input: MovementInput = {
    storeId: text("storeId"),
    variantId: text("variantId"),
    type: text("type") as MovementInput["type"],
    quantity: text("quantity"),
    reason: text("reason"),
  };
  let balanceAfter: string | undefined;
  const state = await runAction(
    async () => {
      balanceAfter = (await recordMovement(context, input)).balanceAfter;
      revalidatePath("/estoque");
      revalidatePath("/estoque/movimentacoes");
    },
    "Movimentação lançada.",
    "recordMovement",
  );
  return balanceAfter === undefined ? state : { ...state, balanceAfter };
}
