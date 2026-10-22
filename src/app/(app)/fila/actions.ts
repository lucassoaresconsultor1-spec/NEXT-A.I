"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { setOwnQueuePin } from "@/server/devices/pin";
import { createDevice, renewPairingCode, revokeDevice } from "@/server/devices/service";
import { pick } from "@/server/forms";
import { assignManual } from "@/server/queue/service";

// Manager view of the queue (m13b): manual assignment, tablets and the member's own
// queue PIN. The services check permissions, store scope and hierarchy.

const INVALID = { status: "error", message: "Dados inválidos." } as const satisfies ActionState;
const idSchema = z.uuid();

export async function assignAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const entryId = idSchema.safeParse(formData.get("entryId"));
  if (!entryId.success) return INVALID;
  return runAction(
    async () => {
      await assignManual(context, entryId.data, pick(formData, ["salespersonId", "reason"]));
      revalidatePath("/fila");
    },
    "Atendimento atribuído.",
    "queueAssign",
  );
}

/** Creates a tablet and returns its one-time pairing code (shown once, never stored in the page). */
export async function createDeviceAction(_state: ActionState, formData: FormData): Promise<ActionState & { code?: string }> {
  const context = await requireTenantContext();
  let code: string | undefined;
  const state = await runAction(
    async () => {
      code = (await createDevice(context, pick(formData, ["storeId", "name"]))).pairingCode;
      revalidatePath("/fila");
    },
    "Tablet cadastrado.",
    "queueCreateDevice",
  );
  return code ? { ...state, code } : state;
}

export async function renewCodeAction(_state: ActionState, formData: FormData): Promise<ActionState & { code?: string }> {
  const context = await requireTenantContext();
  const deviceId = idSchema.safeParse(formData.get("deviceId"));
  if (!deviceId.success) return INVALID;
  let code: string | undefined;
  const state = await runAction(
    async () => {
      code = (await renewPairingCode(context, deviceId.data)).pairingCode;
    },
    "Código renovado.",
    "queueRenewCode",
  );
  return code ? { ...state, code } : state;
}

export async function revokeDeviceAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const deviceId = idSchema.safeParse(formData.get("deviceId"));
  if (!deviceId.success) return INVALID;
  return runAction(
    async () => {
      await revokeDevice(context, deviceId.data);
      revalidatePath("/fila");
    },
    "Tablet revogado.",
    "queueRevokeDevice",
  );
}

export async function setPinAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  return runAction(() => setOwnQueuePin(context, pick(formData, ["pin"])), "PIN de fila salvo.", "queueSetPin");
}
