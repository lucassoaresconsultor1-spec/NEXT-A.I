import "server-only";
import { and, asc, between, count, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { organizationMemberships, queueEntries, queuePresence, sales, salespeople, salespersonStores, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope, can } from "@/server/authz/guard";
import { nextDocumentNumber } from "@/server/counters";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { isUuid } from "@/server/stores/schemas";
import { percentOf, todayIn } from "@/server/targets/schemas";
import { abandonSchema, arrivalSchema, finishSchema, manualSchema, presenceSchema, statsSchema } from "./schemas";

// Store service queue (m13a). Rotation: the available salesperson waiting the
// longest is called; finishing puts them back at the end. Conversion = finished
// attendances with a linked sale ÷ finished attendances (abandonments are reported
// apart and stay out of the denominator).

const ENTRY_NOT_FOUND = () => notFound("Atendimento não encontrado.");

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

async function audit(tx: Tx, context: TenantContext, action: string, entityId: string, storeId: string, changes: Record<string, unknown>) {
  await recordAudit(tx, { organizationId: context.organization.id, actorUserId: context.user.id, action: `queue.${action}`, entityType: "queue_entry", entityId, storeId, changes });
}

async function activeStoreDay(tx: Tx, context: TenantContext, storeId: string) {
  const [store] = await tx.select({ status: stores.status, timezone: stores.timezone }).from(stores).where(and(eq(stores.organizationId, context.organization.id), eq(stores.id, storeId)));
  if (!store) throw notFound("Loja não encontrada.");
  if (store.status !== "active") throw invalid("Loja inativa.");
  return todayIn(store.timezone ?? context.organization.timezone);
}

/** Active salesperson linked to the store, with an active membership. */
async function loadSalesperson(tx: Tx, organizationId: string, salespersonId: string, storeId: string) {
  const [row] = await tx
    .select({ id: salespeople.id, code: salespeople.code, userId: organizationMemberships.userId })
    .from(salespeople)
    .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, salespeople.organizationId), eq(organizationMemberships.id, salespeople.membershipId)))
    .innerJoin(salespersonStores, and(eq(salespersonStores.organizationId, salespeople.organizationId), eq(salespersonStores.salespersonId, salespeople.id), eq(salespersonStores.storeId, storeId)))
    .where(and(eq(salespeople.organizationId, organizationId), eq(salespeople.id, salespersonId), eq(salespeople.isActive, true), eq(organizationMemberships.status, "active")));
  if (!row) throw notFound("Vendedor não encontrado nesta loja.");
  return row;
}

async function setBusy(tx: Tx, organizationId: string, storeId: string, salespersonId: string, status: "busy" | "available") {
  await tx
    .insert(queuePresence)
    .values({ organizationId, storeId, salespersonId, status, since: sql`clock_timestamp()` })
    .onConflictDoUpdate({ target: [queuePresence.organizationId, queuePresence.storeId, queuePresence.salespersonId], set: { status, since: sql`clock_timestamp()` } });
}

async function lockEntry(tx: Tx, context: TenantContext, entryId: string) {
  if (!isUuid(entryId)) throw ENTRY_NOT_FOUND();
  const [entry] = await tx
    .select({ id: queueEntries.id, storeId: queueEntries.storeId, status: queueEntries.status, ticket: queueEntries.ticket, salespersonId: queueEntries.salespersonId, arrivedAt: queueEntries.arrivedAt })
    .from(queueEntries)
    .where(and(eq(queueEntries.organizationId, context.organization.id), eq(queueEntries.id, entryId), storeScopeCondition(context.storeScope, queueEntries.storeId)))
    .for("update");
  if (!entry) throw ENTRY_NOT_FOUND();
  return entry;
}

export async function registerArrival(context: TenantContext, rawInput: unknown): Promise<{ id: string; ticket: number; replayed: boolean }> {
  assertCan(context, "queue.operate");
  const input = parse(arrivalSchema, rawInput);
  assertStoreInScope(context, input.storeId);
  const orgId = context.organization.id;
  const replay = (tx: Tx) =>
    tx.select({ id: queueEntries.id, ticket: queueEntries.ticket, storeId: queueEntries.storeId }).from(queueEntries).where(and(eq(queueEntries.organizationId, orgId), eq(queueEntries.requestKey, input.requestKey)));
  const answer = (previous: { id: string; ticket: number; storeId: string }) => {
    if (previous.storeId !== input.storeId) throw conflict("Chave já usada em outra loja.");
    return { id: previous.id, ticket: previous.ticket, replayed: true };
  };
  try {
    return await withScope(dbScope(context), async (tx) => {
      const [previous] = await replay(tx);
      if (previous) return answer(previous);
      const day = await activeStoreDay(tx, context, input.storeId);
      const ticket = await nextDocumentNumber(tx, orgId, `queue:${input.storeId}:${day}`);
      const [created] = await tx
        .insert(queueEntries)
        .values({ organizationId: orgId, storeId: input.storeId, ticket, day, note: input.note ?? null, requestKey: input.requestKey, createdBy: context.user.id })
        .returning({ id: queueEntries.id });
      await audit(tx, context, "arrival", created.id, input.storeId, { ticket, day });
      return { id: created.id, ticket, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error, "queue_entries_org_request_key")) {
      const [previous] = await withScope(dbScope(context), replay);
      if (previous) return answer(previous);
    }
    throw error;
  }
}

/** The salesperson themself, or queue.operate, marks them available (end of the rotation) or away. */
export async function setPresence(context: TenantContext, rawInput: unknown): Promise<void> {
  const input = parse(presenceSchema, rawInput);
  assertStoreInScope(context, input.storeId);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const person = await loadSalesperson(tx, orgId, input.salespersonId, input.storeId);
    if (person.userId !== context.user.id && !can(context, "queue.operate")) throw forbidden();
    const [current] = await tx
      .select({ status: queuePresence.status })
      .from(queuePresence)
      .where(and(eq(queuePresence.organizationId, orgId), eq(queuePresence.storeId, input.storeId), eq(queuePresence.salespersonId, person.id)))
      .for("update");
    if (current?.status === "busy") throw invalid("O vendedor está em atendimento; encerre o atendimento primeiro.");
    await tx
      .insert(queuePresence)
      .values({ organizationId: orgId, storeId: input.storeId, salespersonId: person.id, status: input.status })
      .onConflictDoUpdate({ target: [queuePresence.organizationId, queuePresence.storeId, queuePresence.salespersonId], set: { status: input.status, since: sql`clock_timestamp()` } });
    await audit(tx, context, "presence_changed", person.id, input.storeId, { code: person.code, status: input.status });
  });
}

/** Oldest waiting customer to the available salesperson waiting the longest; null when nobody waits. */
export async function callNext(context: TenantContext, rawInput: { storeId: string }): Promise<{ entryId: string; salespersonId: string } | null> {
  assertCan(context, "queue.operate");
  if (!isUuid(rawInput?.storeId)) throw notFound("Loja não encontrada.");
  const storeId = rawInput.storeId;
  assertStoreInScope(context, storeId);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await activeStoreDay(tx, context, storeId);
    const [entry] = await tx
      .select({ id: queueEntries.id, ticket: queueEntries.ticket })
      .from(queueEntries)
      .where(and(eq(queueEntries.organizationId, orgId), eq(queueEntries.storeId, storeId), eq(queueEntries.status, "waiting")))
      .orderBy(asc(queueEntries.arrivedAt), asc(queueEntries.ticket))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!entry) return null;
    // Locks every available presence; a concurrent call re-reads them after this commit.
    const available = await tx
      .select({ salespersonId: queuePresence.salespersonId, code: salespeople.code })
      .from(queuePresence)
      .innerJoin(salespeople, and(eq(salespeople.organizationId, queuePresence.organizationId), eq(salespeople.id, queuePresence.salespersonId)))
      .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, salespeople.organizationId), eq(organizationMemberships.id, salespeople.membershipId)))
      .where(and(eq(queuePresence.organizationId, orgId), eq(queuePresence.storeId, storeId), eq(queuePresence.status, "available"), eq(salespeople.isActive, true), eq(organizationMemberships.status, "active")))
      .orderBy(asc(queuePresence.since), asc(queuePresence.salespersonId))
      .for("update", { of: queuePresence });
    const next = available[0];
    if (!next) throw invalid("Nenhum vendedor disponível na fila.");
    await setBusy(tx, orgId, storeId, next.salespersonId, "busy");
    await tx
      .update(queueEntries)
      .set({ status: "in_service", salespersonId: next.salespersonId, assignment: "rotation", startedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(queueEntries.organizationId, orgId), eq(queueEntries.id, entry.id)));
    await audit(tx, context, "assigned", entry.id, storeId, { ticket: entry.ticket, code: next.code, assignment: "rotation" });
    return { entryId: entry.id, salespersonId: next.salespersonId };
  });
}

export async function assignManual(context: TenantContext, entryId: string, rawInput: unknown): Promise<void> {
  assertCan(context, "queue.assign_manual");
  const input = parse(manualSchema, rawInput);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const entry = await lockEntry(tx, context, entryId);
    if (entry.status !== "waiting") throw invalid("Este cliente não está mais aguardando.");
    const person = await loadSalesperson(tx, orgId, input.salespersonId, entry.storeId);
    const [presence] = await tx
      .select({ status: queuePresence.status })
      .from(queuePresence)
      .where(and(eq(queuePresence.organizationId, orgId), eq(queuePresence.storeId, entry.storeId), eq(queuePresence.salespersonId, person.id)))
      .for("update");
    if (presence?.status === "busy") throw invalid("O vendedor já está em atendimento.");
    await setBusy(tx, orgId, entry.storeId, person.id, "busy");
    await tx
      .update(queueEntries)
      .set({ status: "in_service", salespersonId: person.id, assignment: "manual", assignmentReason: input.reason, startedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(queueEntries.organizationId, orgId), eq(queueEntries.id, entry.id)));
    await audit(tx, context, "assigned", entry.id, entry.storeId, { ticket: entry.ticket, code: person.code, assignment: "manual", reason: input.reason });
  });
}

/** The attendant themself, or queue.operate, finishes with a linked sale or with the reason of no sale. */
export async function finishAttendance(context: TenantContext, entryId: string, rawInput: unknown): Promise<void> {
  const input = parse(finishSchema, rawInput);
  const orgId = context.organization.id;
  try {
    await withScope(dbScope(context), async (tx) => {
      const entry = await lockEntry(tx, context, entryId);
      if (entry.status !== "in_service") throw invalid("Este atendimento não está em andamento.");
      const [attendant] = await tx
        .select({ userId: organizationMemberships.userId, code: salespeople.code })
        .from(salespeople)
        .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, salespeople.organizationId), eq(organizationMemberships.id, salespeople.membershipId)))
        .where(and(eq(salespeople.organizationId, orgId), eq(salespeople.id, entry.salespersonId!)));
      if (attendant.userId !== context.user.id && !can(context, "queue.operate")) throw forbidden("Só o vendedor do atendimento ou a recepção encerram.");
      if (input.outcome === "sale") {
        const [sale] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(
            and(
              eq(sales.organizationId, orgId),
              eq(sales.id, input.saleId),
              eq(sales.storeId, entry.storeId),
              eq(sales.status, "completed"),
              eq(sales.salespersonUserId, attendant.userId),
              sql`${sales.completedAt} >= ${entry.arrivedAt}`,
            ),
          );
        if (!sale) throw invalid("Revise os campos destacados.", { saleId: ["Escolha uma venda finalizada desta loja, do vendedor do atendimento, feita depois da chegada."] });
      }
      await tx
        .update(queueEntries)
        .set({
          status: "finished",
          outcome: input.outcome,
          saleId: input.outcome === "sale" ? input.saleId : null,
          closingReason: input.outcome === "no_sale" ? input.reason : null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(queueEntries.organizationId, orgId), eq(queueEntries.id, entry.id)));
      await setBusy(tx, orgId, entry.storeId, entry.salespersonId!, "available");
      await audit(tx, context, "finished", entry.id, entry.storeId, { ticket: entry.ticket, code: attendant.code, outcome: input.outcome });
    });
  } catch (error) {
    if (isUniqueViolation(error, "queue_entries_sale_key")) throw invalid("Revise os campos destacados.", { saleId: ["Esta venda já está vinculada a outro atendimento."] });
    throw error;
  }
}

export async function abandonEntry(context: TenantContext, entryId: string, rawInput: unknown): Promise<void> {
  assertCan(context, "queue.operate");
  const { reason } = parse(abandonSchema, rawInput);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const entry = await lockEntry(tx, context, entryId);
    if (entry.status !== "waiting") throw invalid("Só clientes aguardando podem desistir.");
    await tx.update(queueEntries).set({ status: "abandoned", closingReason: reason, finishedAt: new Date(), updatedAt: new Date() }).where(and(eq(queueEntries.organizationId, orgId), eq(queueEntries.id, entry.id)));
    await audit(tx, context, "abandoned", entry.id, entry.storeId, { ticket: entry.ticket, reason });
  });
}

/** Today's open queue of a store and the presence in rotation order. */
export async function getQueue(context: TenantContext, storeId: string) {
  assertCan(context, "queue.read");
  if (!isUuid(storeId)) throw notFound("Loja não encontrada.");
  assertStoreInScope(context, storeId);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const [store] = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, storeId)));
    if (!store) throw notFound("Loja não encontrada.");
    const entries = await tx
      .select({ id: queueEntries.id, ticket: queueEntries.ticket, status: queueEntries.status, note: queueEntries.note, arrivedAt: queueEntries.arrivedAt, startedAt: queueEntries.startedAt, salespersonId: queueEntries.salespersonId, nickname: salespeople.nickname })
      .from(queueEntries)
      .leftJoin(salespeople, and(eq(salespeople.organizationId, queueEntries.organizationId), eq(salespeople.id, queueEntries.salespersonId)))
      .where(and(eq(queueEntries.organizationId, orgId), eq(queueEntries.storeId, storeId), inArray(queueEntries.status, ["waiting", "in_service"])))
      .orderBy(asc(queueEntries.arrivedAt));
    const presence = await tx
      .select({ salespersonId: queuePresence.salespersonId, nickname: salespeople.nickname, code: salespeople.code, status: queuePresence.status, since: queuePresence.since })
      .from(queuePresence)
      .innerJoin(salespeople, and(eq(salespeople.organizationId, queuePresence.organizationId), eq(salespeople.id, queuePresence.salespersonId)))
      .where(and(eq(queuePresence.organizationId, orgId), eq(queuePresence.storeId, storeId), eq(salespeople.isActive, true)))
      .orderBy(sql`case ${queuePresence.status} when 'available' then 0 when 'busy' then 1 else 2 end`, asc(queuePresence.since));
    return { entries, presence };
  });
}

/** Attendance results by local arrival day; conversion = with sale ÷ finished, one decimal. */
export async function queueStats(context: TenantContext, rawFilters: unknown) {
  assertCan(context, "queue.read");
  const filters = parse(statsSchema, rawFilters);
  if (filters.storeId) assertStoreInScope(context, filters.storeId);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const rows = await tx
      .select({ status: queueEntries.status, outcome: queueEntries.outcome, value: count() })
      .from(queueEntries)
      .where(
        and(
          eq(queueEntries.organizationId, orgId),
          storeScopeCondition(context.storeScope, queueEntries.storeId),
          filters.storeId ? eq(queueEntries.storeId, filters.storeId) : undefined,
          between(queueEntries.day, filters.from, filters.to),
        ),
      )
      .groupBy(queueEntries.status, queueEntries.outcome);
    const sum = (match: (row: (typeof rows)[number]) => boolean) => rows.filter(match).reduce((total, row) => total + row.value, 0);
    const finished = sum((row) => row.status === "finished");
    const withSale = sum((row) => row.status === "finished" && row.outcome === "sale");
    return { finished, withSale, noSale: finished - withSale, abandoned: sum((row) => row.status === "abandoned"), conversion: finished ? percentOf(withSale, finished) : "0.0" };
  });
}
