import "server-only";
import { headers } from "next/headers";

export interface RequestMeta {
  ip: string;
}

/**
 * Client IP as reported by the reverse proxy. Only trustworthy when the host
 * overwrites X-Forwarded-For (Vercel and most managed platforms do); used for
 * rate limiting, stored only as a keyed digest.
 */
export async function getRequestMeta(): Promise<RequestMeta> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || list.get("x-real-ip")?.trim() || "unknown";
  return { ip: ip.slice(0, 64) };
}
