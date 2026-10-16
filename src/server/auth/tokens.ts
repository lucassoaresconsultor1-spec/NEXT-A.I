import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { getAuthSecret } from "@/lib/env";

/** 256 bits of entropy; only its SHA-256 digest is stored. */
export function generateSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Keyed digest for personal data used as a lookup key (e-mail, IP). */
export function keyedDigest(value: string) {
  return createHmac("sha256", getAuthSecret()).update(value).digest("hex");
}
