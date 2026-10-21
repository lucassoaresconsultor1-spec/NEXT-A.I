import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { paymentProviderReferences } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { logger } from "@/lib/logger";
import { applyIntentStatus } from "./intents";
import { getPaymentProvider } from "./registry";
import { MAX_WEBHOOK_BYTES } from "./schemas";

// Provider webhook on a public route (no session). Cheap checks come first and
// never read the body: provider configured (404) and declared size (413). The
// body is then read as a stream with a byte counter, so an oversized or endless
// body is cut at MAX_WEBHOOK_BYTES. The adapter authenticates the signature
// before any data is read; processing is idempotent by provider event id. The
// body never goes to the log.

export type WebhookResult = { status: 200 | 401 | 404 | 413; body: { ok: boolean } };

const NOT_FOUND: WebhookResult = { status: 404, body: { ok: false } };
const TOO_LARGE: WebhookResult = { status: 413, body: { ok: false } };

/** Reads at most `limit` bytes; returns null (and cancels the stream) as soon as the body passes the limit. */
export async function readLimitedBody(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function handlePaymentWebhook(providerKey: string, headers: Headers, body: ReadableStream<Uint8Array> | null): Promise<WebhookResult> {
  const provider = getPaymentProvider();
  if (!provider || provider.key !== providerKey) return NOT_FOUND;
  const declared = Number(headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) return TOO_LARGE;
  const rawBody = await readLimitedBody(body, MAX_WEBHOOK_BYTES);
  if (rawBody === null) return TOO_LARGE;

  const event = await provider.verifyWebhook(headers, rawBody);
  if (!event) {
    logger.warn({ provider: provider.key }, "Payment webhook refused: invalid signature");
    return { status: 401, body: { ok: false } };
  }
  // Global id map: the webhook has no session, so this is the only lookup outside a tenant scope.
  const [owner] = await getDb()
    .select({ organizationId: paymentProviderReferences.organizationId, intentId: paymentProviderReferences.intentId })
    .from(paymentProviderReferences)
    .where(and(eq(paymentProviderReferences.provider, provider.key), eq(paymentProviderReferences.providerReference, event.providerReference)));
  if (!owner) {
    logger.warn({ provider: provider.key, eventId: event.eventId }, "Payment webhook for an unknown reference");
    return { status: 200, body: { ok: true } };
  }
  const result = await withScope({ organizationId: owner.organizationId }, (tx) =>
    applyIntentStatus(tx, owner.organizationId, owner.intentId, { ...event, provider: provider.key, source: "webhook" }),
  );
  logger.info({ provider: provider.key, eventId: event.eventId, applied: result.applied, duplicate: result.duplicate }, "Payment webhook processed");
  return { status: 200, body: { ok: true } };
}
