import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { auditLogs, cashMovements, cashSessionEvents, cashSessions, organizations, plans } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { postCashMovementInTx } from "@/server/cash/ledger";
import { createRegister, listRegisters, setRegisterActive } from "@/server/cash/registers";
import { findOpenSessionForOperator, getSessionSummary, listSessions } from "@/server/cash/session-queries";
import { sessionFiltersSchema } from "@/server/cash/schemas";
import { closeSession, openSession, recordManualMovement, reopenSession } from "@/server/cash/sessions";
import { addMemberFixture, createCashRegisterFixture, createOrganizationFixture, createStoreFixture, uniqueSuffix } from "./fixtures";

async function setup() {
  const org = await createOrganizationFixture();
  const storeId = await createStoreFixture(org.organizationId);
  const otherStoreId = await createStoreFixture(org.organizationId);
  const registerId = await createCashRegisterFixture(org.organizationId, storeId);
  const manager = (await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeId] })).context;
  const cashier = (await addMemberFixture(org.organizationId, { roleKey: "cashier", storeIds: [storeId] })).context;
  const otherCashier = (await addMemberFixture(org.organizationId, { roleKey: "cashier", storeIds: [storeId] })).context;
  const otherManager = (await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [otherStoreId] })).context;
  return { ...org, storeId, otherStoreId, registerId, manager, cashier, otherCashier, otherManager };
}

const openInput = (registerId: string, openingAmountCents = 10000) => ({ registerId, openingAmountCents, idempotencyKey: randomUUID() });
const move = (type: "supply" | "withdrawal", amountCents: number) => ({ type, amountCents, reason: "Movimento de teste", idempotencyKey: randomUUID() });

async function saleCash(organizationId: string, sessionId: string, storeId: string, amountCents: number, actorUserId: string) {
  return withScope({ organizationId }, (tx) =>
    postCashMovementInTx(tx, organizationId, { sessionId, storeId, type: "sale", amountCents, actorUserId, reference: { kind: "sale", id: randomUUID() } }),
  );
}

describe("cash registers", () => {
  it("creates registers with unique names per store and refuses deactivating an open one", async () => {
    const s = await setup();
    const { id } = await createRegister(s.manager, { storeId: s.storeId, name: "Caixa 2" });
    await expect(createRegister(s.manager, { storeId: s.storeId, name: "CAIXA 2" })).rejects.toMatchObject({ code: "conflict", fieldErrors: { name: expect.any(Array) } });
    await expect(createRegister(s.manager, { storeId: s.otherStoreId, name: "Caixa 2" })).rejects.toMatchObject({ code: "not_found" });
    await expect(createRegister(s.cashier, { storeId: s.storeId, name: "Caixa 3" })).rejects.toMatchObject({ code: "forbidden" });
    await openSession(s.cashier, openInput(id));
    await expect(setRegisterActive(s.manager, id, false)).rejects.toMatchObject({ code: "invalid" });
    const listed = await listRegisters(s.cashier, { storeId: s.storeId });
    expect(listed.find((register) => register.id === id)?.openSession).toMatchObject({ openedByName: expect.any(String) });
  });
});

describe("cash sessions: lifecycle", () => {
  it("computes the expected cash from the ledger and closes without difference", async () => {
    const s = await setup();
    const { sessionId } = await openSession(s.cashier, openInput(s.registerId, 10000));
    await recordManualMovement(s.cashier, sessionId, move("supply", 5000));
    await recordManualMovement(s.cashier, sessionId, move("withdrawal", 3000));
    await saleCash(s.organizationId, sessionId, s.storeId, 2000, s.cashier.user.id);
    expect((await getSessionSummary(s.cashier, sessionId))?.totals).toEqual({
      openingCents: 10000,
      suppliesCents: 5000,
      withdrawalsCents: 3000,
      salesCents: 2000,
      refundsCents: 0,
      expectedCents: 14000,
    });
    expect(await closeSession(s.cashier, sessionId, { countedAmountCents: 14000 })).toEqual({ expectedCents: 14000, differenceCents: 0 });
    const trail = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, s.organizationId), eq(auditLogs.entityId, sessionId))).orderBy(asc(auditLogs.createdAt)),
    );
    expect(trail.map((entry) => entry.action)).toEqual([
      "cash_session.opened",
      "cash_session.movement_recorded",
      "cash_session.movement_recorded",
      "cash_session.closed",
    ]);
  });

  it("requires a note for a difference and records it", async () => {
    const s = await setup();
    const { sessionId } = await openSession(s.cashier, openInput(s.registerId, 14000));
    await expect(closeSession(s.cashier, sessionId, { countedAmountCents: 13900 })).rejects.toMatchObject({ fieldErrors: { note: expect.any(Array) } });
    expect(await closeSession(s.cashier, sessionId, { countedAmountCents: 13900, note: "Troco dado a mais" })).toEqual({ expectedCents: 14000, differenceCents: -100 });
    const summary = await getSessionSummary(s.manager, sessionId);
    expect(summary).toMatchObject({ status: "closed", countedCents: 13900, differenceCents: -100, closingNote: "Troco dado a mais" });
    expect(summary?.events.at(-1)).toMatchObject({ type: "closed", reason: "Troco dado a mais" });
  });

  it("refuses taking out more cash than expected", async () => {
    const s = await setup();
    const { sessionId } = await openSession(s.cashier, openInput(s.registerId, 1000));
    await expect(recordManualMovement(s.cashier, sessionId, move("withdrawal", 1001))).rejects.toMatchObject({ fieldErrors: { amountCents: expect.any(Array) } });
    await expect(
      withScope({ organizationId: s.organizationId }, (tx) =>
        postCashMovementInTx(tx, s.organizationId, { sessionId, storeId: s.storeId, type: "refund", amountCents: 1001, actorUserId: s.cashier.user.id, reference: { kind: "refund", id: randomUUID() } }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("is idempotent for openings and movements", async () => {
    const s = await setup();
    const input = openInput(s.registerId);
    const first = await openSession(s.cashier, input);
    expect(await openSession(s.cashier, input)).toEqual({ sessionId: first.sessionId, replayed: true });
    const supply = move("supply", 500);
    const movement = await recordManualMovement(s.cashier, first.sessionId, supply);
    expect(await recordManualMovement(s.cashier, first.sessionId, supply)).toEqual({ movementId: movement.movementId, replayed: true });
    const rows = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(cashMovements).where(and(eq(cashMovements.organizationId, s.organizationId), eq(cashMovements.type, "supply"))),
    );
    expect(rows[0].value).toBe(1);
  });

  it("allows one open session per register and per operator under concurrency", async () => {
    const s = await setup();
    const results = await Promise.allSettled([openSession(s.cashier, openInput(s.registerId)), openSession(s.otherCashier, openInput(s.registerId))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "conflict" });

    const secondRegister = await createCashRegisterFixture(s.organizationId, s.storeId);
    const thirdRegister = await createCashRegisterFixture(s.organizationId, s.storeId);
    const operator = (await addMemberFixture(s.organizationId, { roleKey: "cashier", storeIds: [s.storeId] })).context;
    const both = await Promise.allSettled([openSession(operator, openInput(secondRegister)), openSession(operator, openInput(thirdRegister))]);
    expect(both.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("refuses movements on a closed session", async () => {
    const s = await setup();
    const { sessionId } = await openSession(s.cashier, openInput(s.registerId, 0));
    await closeSession(s.cashier, sessionId, { countedAmountCents: 0 });
    await expect(recordManualMovement(s.cashier, sessionId, move("supply", 100))).rejects.toMatchObject({ code: "invalid" });
    await expect(saleCash(s.organizationId, sessionId, s.storeId, 100, s.cashier.user.id)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("cash sessions: access, reopening and isolation", () => {
  it("keeps sessions private to their operator unless the member manages cash in the store", async () => {
    const s = await setup();
    const { sessionId } = await openSession(s.cashier, openInput(s.registerId));
    expect(await getSessionSummary(s.otherCashier, sessionId)).toBeNull();
    await expect(closeSession(s.otherCashier, sessionId, { countedAmountCents: 10000 })).rejects.toMatchObject({ code: "not_found" });
    expect(await getSessionSummary(s.otherManager, sessionId)).toBeNull();
    expect((await listSessions(s.otherCashier, sessionFiltersSchema.parse({}))).rows).toHaveLength(0);
    expect(await findOpenSessionForOperator(s.cashier, s.storeId)).toMatchObject({ sessionId });
    expect(await findOpenSessionForOperator(s.otherCashier, s.storeId)).toBeNull();
    await closeSession(s.manager, sessionId, { countedAmountCents: 10000 });
  });

  it("reopens only the latest session of a register, by cash.manage, with a reason", async () => {
    const s = await setup();
    const first = await openSession(s.cashier, openInput(s.registerId, 0));
    await closeSession(s.cashier, first.sessionId, { countedAmountCents: 0 });
    await expect(reopenSession(s.cashier, first.sessionId, { reason: "Esqueci uma sangria" })).rejects.toMatchObject({ code: "forbidden" });
    await reopenSession(s.manager, first.sessionId, { reason: "Esqueci uma sangria" });
    const reopened = await getSessionSummary(s.manager, first.sessionId);
    expect(reopened).toMatchObject({ status: "open", countedCents: null, differenceCents: null });
    expect(reopened?.events.map((entry) => entry.type)).toEqual(["opened", "closed", "reopened"]);
    await closeSession(s.cashier, first.sessionId, { countedAmountCents: 0 });

    const second = await openSession(s.cashier, openInput(s.registerId, 0));
    await closeSession(s.cashier, second.sessionId, { countedAmountCents: 0 });
    await expect(reopenSession(s.manager, first.sessionId, { reason: "Tentativa antiga" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses openings without the pos feature and isolates organizations", async () => {
    const s = await setup();
    const { sessionId } = await openSession(s.cashier, openInput(s.registerId));
    const other = await createOrganizationFixture();
    expect(await getSessionSummary(other.owner, sessionId)).toBeNull();
    for (const table of [cashSessions, cashMovements, cashSessionEvents]) {
      const seen = await withScope({ organizationId: other.organizationId }, (tx) => tx.select({ id: table.id }).from(table));
      expect(seen).toHaveLength(0);
    }

    const planKey = `sem_pdv_${uniqueSuffix()}`;
    await getDb().insert(plans).values({ key: planKey, name: "Sem PDV", description: "Plano de teste sem recursos" });
    await withScope({ organizationId: s.organizationId }, (tx) => tx.update(organizations).set({ planKey }).where(eq(organizations.id, s.organizationId)));
    const register = await createCashRegisterFixture(s.organizationId, s.storeId);
    await expect(openSession(s.otherCashier, openInput(register))).rejects.toMatchObject({ code: "limit" });
  });

  it("does not let the ledger rows be changed or deleted", async () => {
    const s = await setup();
    const { sessionId } = await openSession(s.cashier, openInput(s.registerId));
    await withScope({ organizationId: s.organizationId }, async (tx) => {
      await tx.update(cashMovements).set({ amountCents: 1 }).where(eq(cashMovements.sessionId, sessionId));
      await tx.delete(cashSessionEvents).where(eq(cashSessionEvents.sessionId, sessionId));
    });
    const summary = await getSessionSummary(s.cashier, sessionId);
    expect(summary?.totals.openingCents).toBe(10000);
    expect(summary?.events).toHaveLength(1);
  });
});
