"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { parseBrlToCents } from "@/lib/money";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { closeSession, openSession, recordManualMovement, reopenSession } from "@/server/cash/sessions";
import { createRegister, setRegisterActive, updateRegister } from "@/server/cash/registers";
import { invalidState, pick } from "@/server/forms";

const INVALID = { status: "error", message: "Dados do caixa inválidos." } as const satisfies ActionState;
const idSchema = z.uuid();
const moneyError = { status: "error", message: "Revise os campos destacados.", fieldErrors: { amount: ["Informe um valor em reais, como 12,90."] } } as const satisfies ActionState;

function revalidateCash(sessionId?: string) {
  revalidatePath("/caixa");
  revalidatePath("/caixa/caixas");
  revalidatePath("/caixa/sessoes");
  if (sessionId) revalidatePath(`/caixa/sessoes/${sessionId}`);
}

export async function openSessionAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const amount = parseBrlToCents(String(formData.get("openingAmount") ?? ""));
  if (amount === null) return { ...moneyError, fieldErrors: { openingAmount: moneyError.fieldErrors.amount } };
  const parsed = z.object({ registerId: z.uuid(), idempotencyKey: z.uuid() }).safeParse(pick(formData, ["registerId", "idempotencyKey"]));
  if (!parsed.success) return invalidState(parsed.error);
  let sessionId: string | undefined;
  const state = await runAction(async () => {
    sessionId = (await openSession(context, { ...parsed.data, openingAmountCents: amount })).sessionId;
    revalidateCash(sessionId);
  }, "Caixa aberto.", "openCashSession");
  return state;
}

export async function recordMovementAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const sessionId = idSchema.safeParse(formData.get("sessionId"));
  const amount = parseBrlToCents(String(formData.get("amount") ?? ""));
  if (!sessionId.success) return INVALID;
  if (amount === null) return moneyError;
  const parsed = z.object({ type: z.enum(["supply", "withdrawal"]), reason: z.string().trim().min(3).max(240), idempotencyKey: z.uuid() }).safeParse(pick(formData, ["type", "reason", "idempotencyKey"]));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(async () => {
    await recordManualMovement(context, sessionId.data, { ...parsed.data, amountCents: amount });
    revalidateCash(sessionId.data);
  }, parsed.data.type === "supply" ? "Suprimento registrado." : "Sangria registrada.", "recordCashMovement");
}

export async function closeSessionAction(_state: ActionState, formData: FormData): Promise<ActionState & { expectedCents?: number; differenceCents?: number }> {
  const context = await requireTenantContext();
  const sessionId = idSchema.safeParse(formData.get("sessionId"));
  const amount = parseBrlToCents(String(formData.get("countedAmount") ?? ""));
  if (!sessionId.success) return INVALID;
  if (amount === null) return { ...moneyError, fieldErrors: { countedAmount: moneyError.fieldErrors.amount } };
  const note = z.string().max(500).safeParse(formData.get("note") ?? "");
  if (!note.success) return invalidState(note.error);
  let result: { expectedCents: number; differenceCents: number } | undefined;
  const state = await runAction(async () => {
    result = await closeSession(context, sessionId.data, { countedAmountCents: amount, note: note.data });
    revalidateCash(sessionId.data);
  }, "Caixa fechado.", "closeCashSession");
  return { ...state, ...(state.status === "success" && result ? result : {}) };
}

export async function reopenSessionAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = z.object({ sessionId: z.uuid(), reason: z.string().trim().min(3).max(240) }).safeParse(pick(formData, ["sessionId", "reason"]));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(async () => {
    await reopenSession(context, parsed.data.sessionId, { reason: parsed.data.reason });
    revalidateCash(parsed.data.sessionId);
  }, "Caixa reaberto.", "reopenCashSession");
}

export async function saveRegisterAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = z.union([z.literal(""), z.uuid()]).safeParse(formData.get("id") ?? "");
  if (!id.success) return INVALID;
  const fields = id.data ? ["name"] as const : ["storeId", "name"] as const;
  const parsed = id.data
    ? z.object({ name: z.string().trim().min(2).max(60) }).safeParse(pick(formData, fields))
    : z.object({ storeId: z.uuid(), name: z.string().trim().min(2).max(60) }).safeParse(pick(formData, fields));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(async () => {
    if (id.data) await updateRegister(context, id.data, parsed.data);
    else await createRegister(context, parsed.data);
    revalidateCash();
  }, id.data ? "Caixa atualizado." : "Caixa cadastrado.", "saveCashRegister");
}

export async function setRegisterActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).safeParse(pick(formData, ["id", "active"]));
  if (!parsed.success) return INVALID;
  const active = parsed.data.active === "true";
  return runAction(async () => {
    await setRegisterActive(context, parsed.data.id, active);
    revalidateCash();
  }, active ? "Caixa ativado." : "Caixa desativado.", "setCashRegisterActive");
}
