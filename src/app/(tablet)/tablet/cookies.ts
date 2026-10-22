import "server-only";
import { cookies } from "next/headers";
import { TICKET_TTL_MS } from "@/server/devices/tickets";

// Tablet cookies (m13b): the device token and the member ticket live only in
// HttpOnly cookies (never in storage, URLs or logs). __Host- binds them to the
// exact host over HTTPS in production.

const production = process.env.NODE_ENV === "production";
const DEVICE = production ? "__Host-varejo_device" : "varejo_device";
const TICKET = production ? "__Host-varejo_fila" : "varejo_fila";
const options = (maxAge: number) => ({ httpOnly: true, secure: production, sameSite: "lax" as const, path: "/", maxAge });

export async function readTabletCookies() {
  const jar = await cookies();
  return { token: jar.get(DEVICE)?.value, ticket: jar.get(TICKET)?.value };
}

export async function setDeviceCookie(token: string) {
  (await cookies()).set(DEVICE, token, options(60 * 60 * 24 * 365));
}

export async function setTicketCookie(ticket: string) {
  (await cookies()).set(TICKET, ticket, options(TICKET_TTL_MS / 1000));
}

export async function clearTicketCookie() {
  (await cookies()).set(TICKET, "", options(0));
}
