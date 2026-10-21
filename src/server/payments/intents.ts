import "server-only";
import { and, eq } from "drizzle-orm";
import { cashSessions, paymentEvents, paymentIntents, paymentProviderReferences } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope } from "@/server/authz/guard";
import { conflict, invalid, notFound } from "@/server/errors";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import { parse } from "@/server/sales/checks";
import type { ProviderStatus } from "./port";
import { getPaymentProvider } from "./registry";
import { canTransition, createIntentSchema, INTENT_EXPIRATION_SECONDS } from "./schemas";

// Payment intents (ADR-005): written as pending before the provider is called,
// confirmed only by the provider (webhook or status query). The PDV completes
// the sale with a confirmed intent (m06a).

const INTENT_NOT_FOUND = () => notFound("Pagamento não encontrado.");
const NOT_CONFIGURED = "Pagamento por PIX ou cartão integrado ainda não está configurado nesta empresa.";

const publicColumns = {
  id: paymentIntents.id,
  status: paymentIntents.status,
  method: paymentIntents.method,
  amountCents: paymentIntents.amountCents,
  pixQrCode: paymentIntents.pixQrCode,
  pixCopyPaste: paymentIntents.pixCopyPaste,
  expiresAt: paymentIntents.expiresAt,
  failureReason: paymentIntents.failureReason,
};

type IntentView = { id: string; status: ProviderStatus; method: string; amountCents: number; pixQrCode: string | null; pixCopyPaste: string | null; expiresAt: Date | null; failureReason: string | null };

/**
 * Applies a provider status to a locked intent inside the caller's transaction:
 * records the event (idempotent by provider event id), applies allowed
 * transitions and audits. A diverging amount fails the intent.
 */
export async function applyIntentStatus(
  tx: Tx,
  organizationId: string,
  intentId: string,
  event: { provider: string; eventId: string; status: ProviderStatus; amountCents: number; source: "webhook" | "query" },
) {
  const inserted = await tx
    .insert(paymentEvents)
    .values({ organizationId, intentId, provider: event.provider, eventId: event.eventId, status: event.status, amountCents: event.amountCents, source: event.source })
    .onConflictDoNothing()
    .returning({ id: paymentEvents.id });
  if (inserted.length === 0) return { applied: false, duplicate: true };
  const [intent] = await tx
    .select({ status: paymentIntents.status, amountCents: paymentIntents.amountCents, storeId: paymentIntents.storeId })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.organizationId, organizationId), eq(paymentIntents.id, intentId)))
    .for("update");
  if (!intent) return { applied: false, duplicate: false };
  const mismatch = event.status === "confirmed" && event.amountCents !== intent.amountCents;
  const next: ProviderStatus = mismatch ? "failed" : event.status;
  if (!canTransition(intent.status, next)) return { applied: false, duplicate: false };
  await tx
    .update(paymentIntents)
    .set({ status: next, failureReason: mismatch ? "amount_mismatch" : null, updatedAt: new Date() })
    .where(and(eq(paymentIntents.organizationId, organizationId), eq(paymentIntents.id, intentId)));
  await recordAudit(tx, {
    organizationId,
    actorUserId: null,
    action: `payment_intent.${next}`,
    entityType: "payment_intent",
    entityId: intentId,
    storeId: intent.storeId,
    changes: { status: { from: intent.status, to: next }, source: event.source, ...(mismatch ? { reason: "amount_mismatch" } : {}) },
  });
  return { applied: true, duplicate: false };
}

async function readIntent(tx: Tx, context: TenantContext, intentId: string) {
  const [row] = await tx
    .select({ ...publicColumns, storeId: paymentIntents.storeId, operatorUserId: paymentIntents.operatorUserId, provider: paymentIntents.provider, providerReference: paymentIntents.providerReference })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.organizationId, context.organization.id), eq(paymentIntents.id, intentId)));
  if (!row || row.operatorUserId !== context.user.id) throw INTENT_NOT_FOUND();
  return row;
}

function view(row: IntentView & Record<string, unknown>): IntentView {
  return {
    id: row.id,
    status: row.status,
    method: row.method,
    amountCents: row.amountCents,
    pixQrCode: row.pixQrCode,
    pixCopyPaste: row.pixCopyPaste,
    expiresAt: row.expiresAt,
    failureReason: row.failureReason,
  };
}

export async function createPaymentIntent(context: TenantContext, rawInput: unknown): Promise<IntentView & { replayed: boolean }> {
  assertCan(context, "sales.create");
  const input = parse(createIntentSchema, rawInput);
  assertStoreInScope(context, input.storeId);
  const provider = getPaymentProvider();
  if (!provider) throw invalid(NOT_CONFIGURED);
  const orgId = context.organization.id;
  const created = await withScope(dbScope(context), async (tx): Promise<{ kind: "replay"; intent: IntentView } | { kind: "created"; intentId: string }> => {
    await assertFeature(tx, orgId, "pos");
    const [previous] = await tx
      .select({ ...publicColumns, operatorUserId: paymentIntents.operatorUserId })
      .from(paymentIntents)
      .where(and(eq(paymentIntents.organizationId, orgId), eq(paymentIntents.idempotencyKey, input.idempotencyKey)));
    if (previous) {
      if (previous.operatorUserId !== context.user.id) throw conflict("Chave do pagamento já usada.");
      return { kind: "replay", intent: view(previous as IntentView & Record<string, unknown>) };
    }
    const [session] = await tx
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(and(eq(cashSessions.organizationId, orgId), eq(cashSessions.storeId, input.storeId), eq(cashSessions.openedBy, context.user.id), eq(cashSessions.status, "open")));
    if (!session) throw invalid("Abra o caixa antes de vender.");
    const [intent] = await tx
      .insert(paymentIntents)
      .values({
        organizationId: orgId,
        storeId: input.storeId,
        cashSessionId: session.id,
        operatorUserId: context.user.id,
        method: input.method,
        amountCents: input.amountCents,
        provider: provider.key,
        idempotencyKey: input.idempotencyKey,
      })
      .returning({ id: paymentIntents.id });
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "payment_intent.created",
      entityType: "payment_intent",
      entityId: intent.id,
      storeId: input.storeId,
      changes: { method: input.method, amountCents: input.amountCents, provider: provider.key },
    });
    return { kind: "created", intentId: intent.id };
  });
  if (created.kind === "replay") return { ...created.intent, replayed: true };

  // Outside the transaction: a slow provider must not hold database locks.
  let charge: Awaited<ReturnType<typeof provider.createCharge>> | null = null;
  try {
    charge = await provider.createCharge({
      method: input.method,
      amountCents: input.amountCents,
      reference: created.intentId,
      description: "Venda no PDV",
      expiresInSeconds: INTENT_EXPIRATION_SECONDS,
    });
  } catch (error) {
    logger.warn({ provider: provider.key, err: { name: (error as Error)?.name } }, "Payment provider unavailable");
  }
  return withScope(dbScope(context), async (tx) => {
    const target = and(eq(paymentIntents.organizationId, orgId), eq(paymentIntents.id, created.intentId));
    if (!charge) {
      await tx.update(paymentIntents).set({ status: "failed", failureReason: "provider_unavailable", updatedAt: new Date() }).where(target);
    } else {
      // Only the pending state is taken from the creation call; confirmation comes from the webhook or a query.
      await tx
        .update(paymentIntents)
        .set({
          providerReference: charge.providerReference,
          pixQrCode: charge.pix?.qrCode ?? null,
          pixCopyPaste: charge.pix?.copyPaste ?? null,
          expiresAt: charge.pix?.expiresAt ?? new Date(Date.now() + INTENT_EXPIRATION_SECONDS * 1000),
          status: charge.status === "failed" ? "failed" : "pending",
          updatedAt: new Date(),
        })
        .where(target);
      await tx
        .insert(paymentProviderReferences)
        .values({ provider: provider.key, providerReference: charge.providerReference, organizationId: orgId, intentId: created.intentId });
    }
    return { ...view((await readIntent(tx, context, created.intentId)) as IntentView & Record<string, unknown>), replayed: false };
  });
}

/** Asks the provider for the current status and applies it (same rules as the webhook). */
export async function refreshPaymentIntent(context: TenantContext, intentId: string): Promise<IntentView> {
  assertCan(context, "sales.create");
  if (!isUuid(intentId)) throw INTENT_NOT_FOUND();
  const orgId = context.organization.id;
  const intent = await withScope(dbScope(context), (tx) => readIntent(tx, context, intentId));
  const provider = getPaymentProvider();
  if (intent.status === "pending" && intent.providerReference && provider?.key === intent.provider) {
    const remote = await provider.getStatus(intent.providerReference);
    await withScope(dbScope(context), (tx) =>
      applyIntentStatus(tx, orgId, intentId, {
        provider: provider.key,
        eventId: `query:${intentId}:${remote.status}`,
        status: remote.status,
        amountCents: remote.amountCents,
        source: "query",
      }),
    );
  }
  return withScope(dbScope(context), async (tx) => view((await readIntent(tx, context, intentId)) as IntentView & Record<string, unknown>));
}

/** Pending intent not used by any sale -> cancelled (the operator gave up on this payment). */
export async function cancelPaymentIntent(context: TenantContext, intentId: string) {
  assertCan(context, "sales.create");
  if (!isUuid(intentId)) throw INTENT_NOT_FOUND();
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const intent = await readIntent(tx, context, intentId);
    if (intent.status !== "pending") throw invalid("Só pagamentos pendentes podem ser cancelados.");
    await applyIntentStatus(tx, orgId, intentId, { provider: intent.provider, eventId: `cancel:${intentId}`, status: "cancelled", amountCents: intent.amountCents, source: "query" });
  });
}
