"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formFieldErrors } from "@/app/(app)/compras/order-items-form-data";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { pick } from "@/server/forms";
import { dispatchSchema, MAX_TRANSFER_ITEMS, receiveSchema, transferRequestSchema } from "@/server/inventory/transfer-schemas";
import { approveTransfer, cancelTransfer, dispatchTransfer, receiveTransfer, requestTransfer } from "@/server/inventory/transfers";

const INVALID = { status: "error", message: "Transferência inválida." } as const satisfies ActionState;
const idSchema = z.uuid();

const fieldErrorState = (fieldErrors: Record<string, string[]>): ActionState => ({
  status: "error",
  message: "Revise os campos destacados.",
  fieldErrors,
});

function revalidateTransfer(transferId?: string) {
  revalidatePath("/estoque/transferencias");
  if (transferId) revalidatePath(`/estoque/transferencias/${transferId}`);
  revalidatePath("/estoque");
}

/**
 * Indexed rows (items.{i}.idField / items.{i}.valueField) in order, up to the
 * service limit. Every row the form renders is sent, so service errors keyed
 * items.{n}.field match the form rows.
 */
function readRows<K extends string, V extends string>(formData: FormData, idField: K, valueField: V) {
  const rows: (Record<K, string> & Record<V, string>)[] = [];
  for (let index = 0; index < MAX_TRANSFER_ITEMS; index += 1) {
    const id = formData.get(`items.${index}.${idField}`);
    if (typeof id !== "string" || id === "") break;
    const value = formData.get(`items.${index}.${valueField}`);
    rows.push({ [idField]: id, [valueField]: typeof value === "string" ? value.trim() : "" } as Record<K, string> & Record<V, string>);
  }
  return rows;
}

export async function requestTransferAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const input = { ...pick(formData, ["originStoreId", "destinationStoreId", "notes"]), items: readRows(formData, "variantId", "quantity") };
  // Same schema as the service, checked here so item errors land on the right row.
  const parsed = transferRequestSchema.safeParse(input);
  if (!parsed.success) return fieldErrorState(formFieldErrors(parsed.error, []));
  let createdId: string | undefined;
  const state = await runAction(
    async () => {
      createdId = (await requestTransfer(context, input)).id;
      revalidateTransfer();
    },
    "Transferência solicitada.",
    "requestTransfer",
  );
  if (createdId) redirect(`/estoque/transferencias/${createdId}?criada=1`);
  return state;
}

export async function approveTransferAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = idSchema.safeParse(formData.get("transferId"));
  if (!id.success) return INVALID;
  return runAction(
    async () => {
      await approveTransfer(context, id.data);
      revalidateTransfer(id.data);
    },
    "Transferência aprovada.",
    "approveTransfer",
  );
}

export async function dispatchTransferAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = idSchema.safeParse(formData.get("transferId"));
  if (!id.success) return INVALID;
  const input = { items: readRows(formData, "itemId", "quantitySent") };
  const parsed = dispatchSchema.safeParse(input);
  if (!parsed.success) return fieldErrorState(formFieldErrors(parsed.error, []));
  return runAction(
    async () => {
      await dispatchTransfer(context, id.data, input);
      revalidateTransfer(id.data);
    },
    "Transferência despachada.",
    "dispatchTransfer",
  );
}

export async function receiveTransferAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = idSchema.safeParse(formData.get("transferId"));
  if (!id.success) return INVALID;
  const input = { items: readRows(formData, "itemId", "quantityReceived"), ...pick(formData, ["divergenceReason"]) };
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return fieldErrorState(formFieldErrors(parsed.error, []));
  return runAction(
    async () => {
      await receiveTransfer(context, id.data, input);
      revalidateTransfer(id.data);
    },
    "Recebimento registrado.",
    "receiveTransfer",
  );
}

export async function cancelTransferAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = idSchema.safeParse(formData.get("transferId"));
  if (!id.success) return INVALID;
  const { reason } = pick(formData, ["reason"]);
  return runAction(
    async () => {
      await cancelTransfer(context, id.data, reason);
      revalidateTransfer(id.data);
    },
    "Transferência cancelada.",
    "cancelTransfer",
  );
}
