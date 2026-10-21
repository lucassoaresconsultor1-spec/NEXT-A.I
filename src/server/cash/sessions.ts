import "server-only";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { cashMovements, cashRegisters, cashSessionEvents, cashSessions, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { formatCurrencyCents } from "@/lib/format";
import { recordAudit } from "@/server/audit/record";
import { dbScope, isStoreInScope, type TenantContext } from "@/server/authz/context";
import { assertCan, can } from "@/server/authz/guard";
import { conflict, invalid, isUniqueViolation } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import { assertCashAvailable, SESSION_NOT_FOUND, sessionTotals } from "./ledger";
import { closeSessionSchema, manualMovementSchema, openSessionSchema, reopenSchema } from "./schemas";

// Cash sessions: one open session per register and per operator (unique
// partial indexes), opening float, supplies and withdrawals with reason,
// closing with counted cash and server-computed difference, authorized reopening.

const REGISTER_NOT_FOUND = () => invalid("Revise os campos destacados.", { registerId: ["Selecione um caixa ativo de uma loja do seu acesso."] });
const OPEN_CONFLICTS: Record<string, string> = {
  cash_sessions_open_register_idx: "Este caixa já está aberto.",
  cash_sessions_open_operator_idx: "Você já tem um caixa aberto.",
};

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

/** Locks a session the member may act on: its own (cash.operate) or any in a store in scope (cash.manage). */
async function lockActionableSession(tx: Tx, context: TenantContext, sessionId: string) {
  if (!isUuid(sessionId)) throw SESSION_NOT_FOUND();
  const [session] = await tx
    .select({
      id: cashSessions.id,
      storeId: cashSessions.storeId,
      registerId: cashSessions.registerId,
      status: cashSessions.status,
      openedBy: cashSessions.openedBy,
      openedAt: cashSessions.openedAt,
    })
    .from(cashSessions)
    .where(and(eq(cashSessions.organizationId, context.organization.id), eq(cashSessions.id, sessionId)))
    .for("update");
  if (!session || !isStoreInScope(context.storeScope, session.storeId)) throw SESSION_NOT_FOUND();
  const own = session.openedBy === context.user.id && can(context, "cash.operate");
  if (!own && !can(context, "cash.manage")) throw SESSION_NOT_FOUND();
  return session;
}

async function event(tx: Tx, organizationId: string, values: Omit<typeof cashSessionEvents.$inferInsert, "organizationId">) {
  await tx.insert(cashSessionEvents).values({ organizationId, ...values });
}

export async function openSession(context: TenantContext, rawInput: unknown): Promise<{ sessionId: string; replayed: boolean }> {
  assertCan(context, "cash.operate");
  const input = parse(openSessionSchema, rawInput);
  const orgId = context.organization.id;
  const replay = (tx: Tx) =>
    tx
      .select({ id: cashSessions.id, registerId: cashSessions.registerId, openedBy: cashSessions.openedBy })
      .from(cashSessions)
      .where(and(eq(cashSessions.organizationId, orgId), eq(cashSessions.openIdempotencyKey, input.idempotencyKey)));
  try {
    return await withScope(dbScope(context), async (tx) => {
      await assertFeature(tx, orgId, "pos");
      const [previous] = await replay(tx);
      if (previous) {
        if (previous.registerId !== input.registerId || previous.openedBy !== context.user.id) throw conflict("Chave de abertura já usada.");
        return { sessionId: previous.id, replayed: true };
      }
      const [register] = await tx
        .select({ storeId: cashRegisters.storeId, isActive: cashRegisters.isActive, storeStatus: stores.status })
        .from(cashRegisters)
        .innerJoin(stores, and(eq(stores.organizationId, cashRegisters.organizationId), eq(stores.id, cashRegisters.storeId)))
        .where(and(eq(cashRegisters.organizationId, orgId), eq(cashRegisters.id, input.registerId)))
        .for("update", { of: cashRegisters });
      if (!register || !register.isActive || register.storeStatus !== "active" || !isStoreInScope(context.storeScope, register.storeId)) throw REGISTER_NOT_FOUND();
      const [session] = await tx
        .insert(cashSessions)
        .values({
          organizationId: orgId,
          registerId: input.registerId,
          storeId: register.storeId,
          openedBy: context.user.id,
          openingAmountCents: input.openingAmountCents,
          openIdempotencyKey: input.idempotencyKey,
        })
        .returning({ id: cashSessions.id });
      await tx.insert(cashMovements).values({
        organizationId: orgId,
        sessionId: session.id,
        storeId: register.storeId,
        type: "opening",
        amountCents: input.openingAmountCents,
        createdBy: context.user.id,
      });
      await event(tx, orgId, { sessionId: session.id, type: "opened", actorUserId: context.user.id });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "cash_session.opened",
        entityType: "cash_session",
        entityId: session.id,
        storeId: register.storeId,
        changes: { registerId: input.registerId, openingAmountCents: input.openingAmountCents },
      });
      return { sessionId: session.id, replayed: false };
    });
  } catch (error) {
    for (const [constraint, message] of Object.entries(OPEN_CONFLICTS)) {
      if (isUniqueViolation(error, constraint)) throw conflict(message);
    }
    if (isUniqueViolation(error, "cash_sessions_org_open_key_key")) {
      // A concurrent retry with the same key committed first: answer with its session.
      const [previous] = await withScope(dbScope(context), (tx) => replay(tx));
      if (previous) return { sessionId: previous.id, replayed: true };
    }
    throw error;
  }
}

export async function recordManualMovement(context: TenantContext, sessionId: string, rawInput: unknown): Promise<{ movementId: string; replayed: boolean }> {
  const input = parse(manualMovementSchema, rawInput);
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      await assertFeature(tx, orgId, "pos");
      const session = await lockActionableSession(tx, context, sessionId);
      const [previous] = await tx
        .select({ id: cashMovements.id, sessionId: cashMovements.sessionId })
        .from(cashMovements)
        .where(and(eq(cashMovements.organizationId, orgId), eq(cashMovements.idempotencyKey, input.idempotencyKey)));
      if (previous) {
        if (previous.sessionId !== session.id) throw conflict("Chave do movimento já usada.");
        return { movementId: previous.id, replayed: true };
      }
      if (session.status !== "open") throw invalid("A sessão de caixa está fechada.");
      if (input.type === "withdrawal") await assertCashAvailable(tx, orgId, session.id, input.amountCents, "amountCents");
      const [movement] = await tx
        .insert(cashMovements)
        .values({
          organizationId: orgId,
          sessionId: session.id,
          storeId: session.storeId,
          type: input.type,
          amountCents: input.amountCents,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          createdBy: context.user.id,
        })
        .returning({ id: cashMovements.id });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "cash_session.movement_recorded",
        entityType: "cash_session",
        entityId: session.id,
        storeId: session.storeId,
        changes: { type: input.type, amountCents: input.amountCents, reason: input.reason },
      });
      return { movementId: movement.id, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error, "cash_movements_org_key_idx")) throw conflict("Este movimento já foi registrado. Atualize a tela.");
    throw error;
  }
}

export async function closeSession(context: TenantContext, sessionId: string, rawInput: unknown) {
  const input = parse(closeSessionSchema, rawInput);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const session = await lockActionableSession(tx, context, sessionId);
    if (session.status !== "open") throw invalid("Esta sessão de caixa já está fechada.");
    const { expectedCents } = await sessionTotals(tx, orgId, session.id);
    const differenceCents = input.countedAmountCents - expectedCents;
    const note = input.note?.trim() ?? "";
    if (differenceCents !== 0 && note.length < 3) {
      throw invalid("Revise os campos destacados.", { note: [`Explique a diferença de ${formatCurrencyCents(differenceCents)}.`] });
    }
    const now = new Date();
    await tx
      .update(cashSessions)
      .set({
        status: "closed",
        closedBy: context.user.id,
        closedAt: now,
        countedAmountCents: input.countedAmountCents,
        expectedAmountCents: expectedCents,
        differenceCents,
        closingNote: note || null,
        updatedAt: now,
      })
      .where(and(eq(cashSessions.organizationId, orgId), eq(cashSessions.id, session.id)));
    await event(tx, orgId, {
      sessionId: session.id,
      type: "closed",
      actorUserId: context.user.id,
      reason: note || null,
      countedCents: input.countedAmountCents,
      expectedCents,
      differenceCents,
    });
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "cash_session.closed",
      entityType: "cash_session",
      entityId: session.id,
      storeId: session.storeId,
      changes: { countedCents: input.countedAmountCents, expectedCents, differenceCents, ...(note ? { note } : {}) },
    });
    return { expectedCents, differenceCents };
  });
}

/** Only the most recent session of the register, and only when neither the register nor its operator has another open session. */
export async function reopenSession(context: TenantContext, sessionId: string, rawInput: unknown) {
  assertCan(context, "cash.manage");
  const { reason } = parse(reopenSchema, rawInput);
  const orgId = context.organization.id;
  try {
    await withScope(dbScope(context), async (tx) => {
      await assertFeature(tx, orgId, "pos");
      const session = await lockActionableSession(tx, context, sessionId);
      if (session.status !== "closed") throw invalid("Esta sessão de caixa já está aberta.");
      const [newer] = await tx
        .select({ id: cashSessions.id })
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.organizationId, orgId),
            eq(cashSessions.registerId, session.registerId),
            ne(cashSessions.id, session.id),
            // Compared in SQL: a JS Date drops the microseconds of opened_at.
            gt(cashSessions.openedAt, sql`(select s.opened_at from cash_sessions s where s.organization_id = ${orgId} and s.id = ${session.id})`),
          ),
        )
        .orderBy(desc(cashSessions.openedAt))
        .limit(1);
      if (newer) throw invalid("Só a sessão mais recente do caixa pode ser reaberta.");
      const now = new Date();
      await tx
        .update(cashSessions)
        .set({ status: "open", closedBy: null, closedAt: null, countedAmountCents: null, expectedAmountCents: null, differenceCents: null, closingNote: null, updatedAt: now })
        .where(and(eq(cashSessions.organizationId, orgId), eq(cashSessions.id, session.id)));
      await event(tx, orgId, { sessionId: session.id, type: "reopened", actorUserId: context.user.id, reason });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "cash_session.reopened",
        entityType: "cash_session",
        entityId: session.id,
        storeId: session.storeId,
        changes: { reason },
      });
    });
  } catch (error) {
    for (const [constraint, message] of Object.entries(OPEN_CONFLICTS)) {
      if (isUniqueViolation(error, constraint)) throw conflict(message.replace("Você já tem", "O operador já tem"));
    }
    throw error;
  }
}
