"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import type { TenantContext } from "@/server/authz/context";
import { pairDevice } from "@/server/devices/service";
import { actorFromTicket, issueActorTicket } from "@/server/devices/tickets";
import { getRequestMeta } from "@/server/http";
import { eligibleSales } from "@/server/queue/sales-link";
import { abandonEntry, callNext, finishAttendance, registerArrival, setPresence } from "@/server/queue/service";
import { clearTicketCookie, readTabletCookies, setDeviceCookie, setTicketCookie } from "./cookies";

// Tablet actions (m13b). Pairing and unlocking use the device token; every member
// action checks the ticket, the device and the member again (actorFromTicket) and
// runs the queue services with the restricted context, always in the device's store.

const EXPIRED: ActionState = { status: "error", message: "A sessão do tablet terminou. Toque no seu nome e digite o PIN de novo." };
const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

async function asMember(work: (context: TenantContext, storeId: string) => Promise<void>, success: string, name: string): Promise<ActionState> {
  const { token, ticket } = await readTabletCookies();
  const actor = await actorFromTicket(token, ticket);
  if (!actor) {
    await clearTicketCookie();
    revalidatePath("/tablet");
    return EXPIRED;
  }
  await setTicketCookie(actor.ticket);
  const state = await runAction(() => work(actor.context, actor.context.activeStoreId!), success, name);
  revalidatePath("/tablet");
  return state;
}

export async function pairAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  let paired = false;
  const state = await runAction(
    async () => {
      const { token } = await pairDevice(text(formData, "code"), (await getRequestMeta()).ip);
      await setDeviceCookie(token);
      paired = true;
    },
    "Tablet pareado.",
    "tabletPair",
  );
  if (paired) redirect("/tablet");
  return state;
}

export async function unlockAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const { token } = await readTabletCookies();
  const state = await runAction(
    async () => setTicketCookie(await issueActorTicket(token, { membershipId: text(formData, "membershipId"), pin: text(formData, "pin") })),
    "Pronto.",
    "tabletUnlock",
  );
  if (state.status === "success") revalidatePath("/tablet");
  return state;
}

export async function lockAction() {
  await clearTicketCookie();
  redirect("/tablet");
}

export async function arrivalAction(_state: ActionState, formData: FormData): Promise<ActionState & { ticketNumber?: number }> {
  let ticketNumber: number | undefined;
  const state = await asMember(
    async (context, storeId) => {
      ticketNumber = (await registerArrival(context, { storeId, requestKey: text(formData, "requestKey"), note: text(formData, "note"), departmentId: text(formData, "departmentId") })).ticket;
    },
    "Chegada registrada.",
    "tabletArrival",
  );
  return ticketNumber ? { ...state, message: `Senha ${ticketNumber} registrada.`, ticketNumber } : state;
}

export async function callNextAction(): Promise<ActionState> {
  let called = true;
  const state = await asMember(
    async (context, storeId) => {
      called = (await callNext(context, { storeId })) !== null;
    },
    "Cliente chamado.",
    "tabletCallNext",
  );
  return state.status === "success" && !called ? { status: "success", message: "Ninguém aguardando." } : state;
}

export async function presenceAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return asMember((context, storeId) => setPresence(context, { storeId, salespersonId: text(formData, "salespersonId"), status: text(formData, "status") }), "Presença atualizada.", "tabletPresence");
}

export async function finishAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const outcome = text(formData, "outcome");
  const input = outcome === "sale" ? { outcome, saleId: text(formData, "saleId") } : { outcome, reason: text(formData, "reason") };
  return asMember((context) => finishAttendance(context, text(formData, "entryId"), input), "Atendimento encerrado.", "tabletFinish");
}

export async function abandonAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return asMember((context) => abandonEntry(context, text(formData, "entryId"), { reason: text(formData, "reason") }), "Desistência registrada.", "tabletAbandon");
}

const entryIdSchema = z.uuid();

/** Sales the attendance may be closed with; empty when the ticket ended or nothing is eligible. */
export async function eligibleSalesAction(entryId: string): Promise<{ saleId: string; label: string }[]> {
  if (!entryIdSchema.safeParse(entryId).success) return [];
  const { token, ticket } = await readTabletCookies();
  const actor = await actorFromTicket(token, ticket);
  if (!actor) return [];
  await setTicketCookie(actor.ticket);
  const rows = await eligibleSales(actor.context, entryId).catch(() => []);
  return rows.map((row) => ({ saleId: row.saleId, label: `Venda nº ${row.number} · ${(row.totalCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` }));
}
