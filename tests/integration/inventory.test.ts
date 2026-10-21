import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { auditLogs, inventoryBalances, inventoryMovements, organizations, plans } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { balanceFiltersSchema, movementFiltersSchema, type MovementInput } from "@/server/inventory/schemas";
import { listBalances, listMovements, recordMovement } from "@/server/inventory/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, uniqueSuffix } from "./fixtures";

const reason = "Lançamento de teste";
const balances = (values: Record<string, unknown> = {}) => balanceFiltersSchema.parse(values);
const movements = (values: Record<string, unknown> = {}) => movementFiltersSchema.parse(values);

async function ledgerState(organizationId: string, storeId: string, variantId: string) {
  return withScope({ organizationId }, async (tx) => {
    const rows = await tx
      .select({ type: inventoryMovements.type, quantity: inventoryMovements.quantity, balanceAfter: inventoryMovements.balanceAfter })
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.storeId, storeId), eq(inventoryMovements.variantId, variantId)))
      .orderBy(asc(inventoryMovements.createdAt));
    const [sum] = await tx
      .select({ value: sql<string>`coalesce(sum(${inventoryMovements.quantity}), 0)::numeric(14,3)::text` })
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.storeId, storeId), eq(inventoryMovements.variantId, variantId)));
    const [balance] = await tx
      .select({ quantity: inventoryBalances.quantity })
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.storeId, storeId), eq(inventoryBalances.variantId, variantId)));
    return { rows, sum: sum.value, balance: balance?.quantity ?? null };
  });
}

async function setup() {
  const org = await createOrganizationFixture();
  const storeId = await createStoreFixture(org.organizationId);
  const { variantId } = await createVariantFixture(org.organizationId);
  const move = (input: Partial<MovementInput>) =>
    recordMovement(org.owner, { storeId, variantId, type: "entry", quantity: "1", reason, ...input } as MovementInput);
  return { ...org, storeId, variantId, move };
}

describe("inventory ledger", () => {
  it("derives the balance from entry, exit, loss, adjustment and count movements", async () => {
    const { organizationId, owner, ownerId, storeId, variantId, move } = await setup();
    expect(await move({ type: "entry", quantity: "10" })).toMatchObject({ quantity: "10.000", balanceAfter: "10.000" });
    await move({ type: "exit", quantity: "3" });
    await move({ type: "loss", quantity: "1" });
    await move({ type: "adjustment", quantity: "-2" });
    expect(await move({ type: "count", quantity: "7" })).toMatchObject({ quantity: "3.000", balanceAfter: "7.000" });

    const state = await ledgerState(organizationId, storeId, variantId);
    expect(state.rows).toEqual([
      { type: "entry", quantity: "10.000", balanceAfter: "10.000" },
      { type: "exit", quantity: "-3.000", balanceAfter: "7.000" },
      { type: "loss", quantity: "-1.000", balanceAfter: "6.000" },
      { type: "adjustment", quantity: "-2.000", balanceAfter: "4.000" },
      { type: "count", quantity: "3.000", balanceAfter: "7.000" },
    ]);
    expect(state.balance).toBe("7.000");
    expect(state.sum).toBe(state.balance);

    const trail = await withScope({ organizationId }, (tx) =>
      tx
        .select({ action: auditLogs.action, storeId: auditLogs.storeId, actorUserId: auditLogs.actorUserId, changes: auditLogs.changes })
        .from(auditLogs)
        .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityType, "inventory_movement")))
        .orderBy(asc(auditLogs.createdAt)),
    );
    expect(trail).toHaveLength(5);
    expect(trail.every((entry) => entry.action === "inventory.movement_recorded" && entry.storeId === storeId && entry.actorUserId === ownerId)).toBe(true);
    expect(trail[4].changes).toMatchObject({ type: "count", quantity: "3.000", balanceAfter: "7.000", countedQuantity: "7.000", reason });

    const listed = await listMovements(owner, movements({ storeId, type: "count" }));
    expect(listed.rows.map((row) => row.countedQuantity)).toEqual(["7.000"]);
    expect((await listBalances(owner, balances({ storeId }))).rows).toEqual([
      expect.objectContaining({ storeId, variantId, quantity: "7.000", unit: "un" }),
    ]);
  });

  it("refuses a negative balance without writing anything", async () => {
    const { organizationId, storeId, variantId, move } = await setup();
    await move({ type: "entry", quantity: "2" });
    await expect(move({ type: "exit", quantity: "3" })).rejects.toMatchObject({ code: "invalid", fieldErrors: { quantity: expect.any(Array) } });
    await expect(move({ type: "adjustment", quantity: "-5" })).rejects.toMatchObject({ code: "invalid" });
    const state = await ledgerState(organizationId, storeId, variantId);
    expect(state.rows).toHaveLength(1);
    expect(state.balance).toBe("2.000");
    const [audits] = await withScope({ organizationId }, (tx) =>
      tx.select({ value: sql<number>`count(*)::int` }).from(auditLogs).where(eq(auditLogs.entityType, "inventory_movement")),
    );
    expect(audits.value).toBe(1);
  });

  it("keeps the balance exact under concurrent exits", async () => {
    const { organizationId, storeId, variantId, move } = await setup();
    await move({ type: "entry", quantity: "5" });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => move({ type: "exit", quantity: "1" })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    const state = await ledgerState(organizationId, storeId, variantId);
    expect(state.balance).toBe("0.000");
    expect(state.sum).toBe("0.000");
    // Ledger order follows the order in which the balance lock was taken.
    expect(state.rows.map((row) => row.balanceAfter)).toEqual(["5.000", "4.000", "3.000", "2.000", "1.000", "0.000"]);
  });

  it("accepts fractions only for products not sold by unit", async () => {
    const { organizationId, owner, storeId, move } = await setup();
    await expect(move({ quantity: "1,5" })).rejects.toMatchObject({ code: "invalid", fieldErrors: { quantity: expect.any(Array) } });
    const bulk = await createVariantFixture(organizationId, { unit: "kg" });
    await expect(recordMovement(owner, { storeId, variantId: bulk.variantId, type: "entry", quantity: "1,25", reason })).resolves.toMatchObject({
      balanceAfter: "1.250",
    });
  });

  it("refuses entries for inactive items and any movement in inactive stores", async () => {
    const { organizationId, owner, storeId, move } = await setup();
    const inactive = await createVariantFixture(organizationId, { variantActive: false });
    await expect(recordMovement(owner, { storeId, variantId: inactive.variantId, type: "entry", quantity: "1", reason })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(recordMovement(owner, { storeId, variantId: inactive.variantId, type: "count", quantity: "0", reason })).resolves.toBeDefined();
    const closed = await createStoreFixture(organizationId, { status: "inactive" });
    await expect(move({ storeId: closed })).rejects.toMatchObject({ code: "invalid" });
  });

  it("keeps the ledger immutable and balances undeletable in the database", async () => {
    const { organizationId, storeId, variantId, move } = await setup();
    await move({ quantity: "4" });
    await withScope({ organizationId }, async (tx) => {
      expect(await tx.update(inventoryMovements).set({ reason: "alterado" }).where(eq(inventoryMovements.organizationId, organizationId)).returning()).toHaveLength(0);
      expect(await tx.delete(inventoryMovements).where(eq(inventoryMovements.organizationId, organizationId)).returning()).toHaveLength(0);
      expect(await tx.delete(inventoryBalances).where(eq(inventoryBalances.organizationId, organizationId)).returning()).toHaveLength(0);
    });
    await expect(
      withScope({ organizationId }, (tx) =>
        tx.update(inventoryBalances).set({ quantity: "-1" }).where(and(eq(inventoryBalances.storeId, storeId), eq(inventoryBalances.variantId, variantId))),
      ),
    ).rejects.toThrow();
    expect((await ledgerState(organizationId, storeId, variantId)).balance).toBe("4.000");
  });
});

describe("inventory authorization and isolation", () => {
  it("limits store managers to their stores and front-line roles to reading", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const { variantId } = await createVariantFixture(organizationId);
    const storeA = await createStoreFixture(organizationId);
    const storeB = await createStoreFixture(organizationId);
    await recordMovement(owner, { storeId: storeB, variantId, type: "entry", quantity: "9", reason });
    const manager = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeA] });
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeA] });

    await expect(recordMovement(manager.context, { storeId: storeA, variantId, type: "entry", quantity: "2", reason })).resolves.toBeDefined();
    await expect(recordMovement(manager.context, { storeId: storeB, variantId, type: "exit", quantity: "1", reason })).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await listBalances(manager.context, balances())).rows.map((row) => row.storeId)).toEqual([storeA]);
    expect((await listBalances(manager.context, balances({ storeId: storeB }))).total).toBe(0);
    expect((await listMovements(manager.context, movements())).rows.map((row) => row.storeId)).toEqual([storeA]);
    expect((await listBalances(owner, balances({ variantId }))).total).toBe(2);

    expect((await listBalances(seller.context, balances())).total).toBe(1);
    await expect(recordMovement(seller.context, { storeId: storeA, variantId, type: "exit", quantity: "1", reason })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("never moves stock of another organization's store or product", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const storeA = await createStoreFixture(a.organizationId);
    const storeB = await createStoreFixture(b.organizationId);
    const variantA = (await createVariantFixture(a.organizationId)).variantId;
    const variantB = (await createVariantFixture(b.organizationId)).variantId;
    await expect(recordMovement(a.owner, { storeId: storeB, variantId: variantA, type: "entry", quantity: "1", reason })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(recordMovement(a.owner, { storeId: storeA, variantId: variantB, type: "entry", quantity: "1", reason })).rejects.toMatchObject({
      code: "not_found",
    });
    await recordMovement(b.owner, { storeId: storeB, variantId: variantB, type: "entry", quantity: "3", reason });
    expect((await listBalances(a.owner, balances())).total).toBe(0);
    expect((await listMovements(a.owner, movements({ storeId: storeB }))).total).toBe(0);
    // Composite foreign keys reject a cross-tenant ledger row even without the service.
    await expect(
      withScope({ organizationId: a.organizationId }, (tx) =>
        tx.insert(inventoryMovements).values({
          organizationId: a.organizationId,
          storeId: storeA,
          variantId: variantB,
          type: "entry",
          quantity: "1",
          balanceAfter: "1",
          reason,
        }),
      ),
    ).rejects.toThrow();
  });

  it("requires the inventory feature of the plan", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const { variantId } = await createVariantFixture(organizationId);
    const planKey = `sem_estoque_${uniqueSuffix()}`;
    await getDb().insert(plans).values({ key: planKey, name: "Sem estoque", description: "Plano de teste sem recursos" });
    await withScope({ organizationId }, (tx) => tx.update(organizations).set({ planKey }).where(eq(organizations.id, organizationId)));
    await expect(recordMovement(owner, { storeId, variantId, type: "entry", quantity: "1", reason })).rejects.toMatchObject({ code: "limit" });
    await expect(listBalances(owner, balances())).rejects.toMatchObject({ code: "limit" });
  });
});
