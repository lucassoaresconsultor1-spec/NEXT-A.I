"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { searchVariants } from "@/server/catalog/variant-search";
import { pick } from "@/server/forms";
import { receiveGoods } from "@/server/purchasing/receiving";
import { purchaseOrderInputSchema } from "@/server/purchasing/schemas";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
} from "@/server/purchasing/service";
import { formFieldErrors, readOrderItems, readReceiptItems, remapFieldErrors } from "./order-items-form-data";

const INVALID = { status: "error", message: "Pedido inválido." } as const satisfies ActionState;
const HEADER_FIELDS = ["storeId", "supplierId", "expectedDate", "notes"] as const;

const idSchema = z.uuid();
const optionalId = z.union([z.literal(""), z.uuid()]).optional();

const fieldErrorState = (fieldErrors: Record<string, string[]>): ActionState => ({
  status: "error",
  message: "Revise os campos destacados.",
  fieldErrors,
});

function revalidateOrder(orderId?: string) {
  revalidatePath("/compras");
  if (orderId) revalidatePath(`/compras/${orderId}`);
}

/** Active variants for the order form picker; never returns costs. */
export async function searchVariantsAction(q: string): Promise<{ variantId: string; label: string; sku: string; unit: string }[]> {
  const context = await requireTenantContext();
  if (typeof q !== "string" || q.trim().length < 2) return [];
  const hits = await searchVariants(context, q, { activeOnly: true });
  return hits.map((hit) => ({ variantId: hit.variantId, label: `${hit.productName} · ${hit.variantName}`, sku: hit.sku, unit: hit.unit }));
}

export async function savePurchaseOrderAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const orderId = optionalId.safeParse(formData.get("orderId") ?? undefined);
  if (!orderId.success) return INVALID;
  const read = readOrderItems(formData);
  const input = { ...pick(formData, HEADER_FIELDS), items: read.items };
  // Same schema as the service, checked here so item errors land on the right form row.
  const parsed = purchaseOrderInputSchema.safeParse(input);
  const fieldErrors = { ...read.fieldErrors, ...(parsed.success ? {} : formFieldErrors(parsed.error, read.formIndexes)) };
  if (Object.keys(fieldErrors).length > 0) return fieldErrorState(fieldErrors);
  let savedId: string | undefined;
  const state = await runAction(
    async () => {
      if (orderId.data) {
        await updatePurchaseOrder(context, orderId.data, input);
        savedId = orderId.data;
      } else {
        savedId = (await createPurchaseOrder(context, input)).id;
      }
      revalidateOrder(savedId);
    },
    "Pedido salvo.",
    "savePurchaseOrder",
  );
  if (state.status === "success" && savedId) redirect(`/compras/${savedId}?salvo=1`);
  return { ...state, fieldErrors: remapFieldErrors(state.fieldErrors, read.formIndexes) };
}

export async function approvePurchaseOrderAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = idSchema.safeParse(formData.get("orderId"));
  if (!id.success) return INVALID;
  return runAction(
    async () => {
      await approvePurchaseOrder(context, id.data);
      revalidateOrder(id.data);
    },
    "Pedido aprovado.",
    "approvePurchaseOrder",
  );
}

export async function cancelPurchaseOrderAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = idSchema.safeParse(formData.get("orderId"));
  if (!id.success) return INVALID;
  const { reason } = pick(formData, ["reason"]);
  return runAction(
    async () => {
      await cancelPurchaseOrder(context, id.data, reason);
      revalidateOrder(id.data);
    },
    "Pedido cancelado.",
    "cancelPurchaseOrder",
  );
}

export async function closePurchaseOrderAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = idSchema.safeParse(formData.get("orderId"));
  if (!id.success) return INVALID;
  const { reason } = pick(formData, ["reason"]);
  return runAction(
    async () => {
      await closePurchaseOrder(context, id.data, reason);
      revalidateOrder(id.data);
    },
    "Pendências encerradas.",
    "closePurchaseOrder",
  );
}

export async function receiveGoodsAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = idSchema.safeParse(formData.get("orderId"));
  if (!id.success) return INVALID;
  const read = readReceiptItems(formData);
  if (read.items.length === 0) return fieldErrorState({ items: ["Informe a quantidade recebida de ao menos um item."] });
  // The key comes from the server-rendered page, so a resubmission of the same form is a replay.
  const { idempotencyKey, notes } = pick(formData, ["idempotencyKey", "notes"]);
  const state = await runAction(
    async () => {
      await receiveGoods(context, id.data, { idempotencyKey, notes, items: read.items });
      revalidateOrder(id.data);
      revalidatePath("/estoque");
    },
    "Recebimento registrado. As entradas foram lançadas no estoque.",
    "receiveGoods",
  );
  if (state.status === "success") redirect(`/compras/${id.data}?recebido=1`);
  return { ...state, fieldErrors: remapFieldErrors(state.fieldErrors, read.formIndexes) };
}
