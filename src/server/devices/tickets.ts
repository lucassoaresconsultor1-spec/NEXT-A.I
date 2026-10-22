import "server-only";
import { timingSafeEqual } from "node:crypto";
import { keyedDigest } from "@/server/auth/tokens";
import type { TenantContext } from "@/server/authz/context";
import { deviceActor, deviceFromToken, memberContext } from "./service";

// Tablet actor tickets (m13b): after a correct PIN the tablet keeps, in an HttpOnly
// cookie, a ticket signed with the application secret that is valid for 2 minutes
// and renewed on each action. Every use checks the device and the member again, so
// revoking the tablet or deactivating the member cuts it immediately.

export const TICKET_TTL_MS = 2 * 60_000;

const sign = (deviceId: string, membershipId: string, expires: number) => keyedDigest(`queue-ticket:${deviceId}:${membershipId}:${expires}`);
const issue = (deviceId: string, membershipId: string) => {
  const expires = Date.now() + TICKET_TTL_MS;
  return `${membershipId}.${expires}.${sign(deviceId, membershipId, expires)}`;
};

/** Checks the PIN (with its attempt limits) and returns the ticket for the tablet. */
export async function issueActorTicket(token: string | undefined, input: { membershipId: string; pin: string }): Promise<string> {
  await deviceActor(token, input);
  const device = await deviceFromToken(token);
  return issue(device!.id, input.membershipId);
}

/** The member's restricted context and a renewed ticket, or null when the ticket is invalid or expired. */
export async function actorFromTicket(token: string | undefined, ticket: string | undefined): Promise<{ context: TenantContext; ticket: string } | null> {
  if (!ticket) return null;
  const [membershipId, rawExpires, signature] = ticket.split(".");
  const expires = Number(rawExpires);
  if (!membershipId || !signature || !Number.isFinite(expires) || expires < Date.now()) return null;
  const device = await deviceFromToken(token);
  if (!device) return null;
  const expected = Buffer.from(sign(device.id, membershipId, expires));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  const context = await memberContext(device, membershipId);
  return context ? { context, ticket: issue(device.id, membershipId) } : null;
}
