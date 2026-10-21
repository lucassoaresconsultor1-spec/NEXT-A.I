import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inventoryBalances, inventoryReservations } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { consumeReservation, releaseReservation, reserveStock } from "@/server/inventory/reservations";
import { recordMovement } from "@/server/inventory/service";
import { createOrganizationFixture, createStoreFixture, createVariantFixture } from "./fixtures";

const milli = (value: number) => BigInt(value * 1000);

async function setup() {
  const org = await createOrganizationFixture();
  const storeId = await createStoreFixture(org.organizationId);
  const { variantId } = await createVariantFixture(org.organizationId);
  await recordMovement(org.owner, { storeId, variantId, type: "entry", quantity: "10", reason: "Estoque inicial" });
  return { ...org, storeId, variantId };
}

describe("inventory reservations", () => {
  it("keeps reserved equal to the sum of active reservations", async () => {
    const s = await setup();
    const scope = { organizationId: s.organizationId };
    const reserve = (quantity: number) =>
      withScope(scope, (tx) =>
        reserveStock(tx, s.organizationId, { storeId: s.storeId, variantId: s.variantId, quantityMilli: milli(quantity), source: "sale", sourceId: randomUUID(), actorUserId: s.ownerId }),
      );
    const first = await reserve(3);
    const second = await reserve(2);
    await expect(reserve(6)).rejects.toMatchObject({ code: "invalid", fieldErrors: { quantity: expect.any(Array) } });

    expect(await withScope(scope, (tx) => releaseReservation(tx, s.organizationId, first.id))).toBe(true);
    expect(await withScope(scope, (tx) => releaseReservation(tx, s.organizationId, first.id))).toBe(false);
    const consumed = await withScope(scope, (tx) => consumeReservation(tx, s.organizationId, second.id));
    expect(consumed).toMatchObject({ storeId: s.storeId, variantId: s.variantId, quantityMilli: milli(2) });
    await expect(withScope(scope, (tx) => consumeReservation(tx, s.organizationId, second.id))).rejects.toMatchObject({ code: "invalid" });

    const third = await reserve(4);
    const [balance] = await withScope(scope, (tx) =>
      tx.select({ reserved: inventoryBalances.reserved }).from(inventoryBalances).where(and(eq(inventoryBalances.organizationId, s.organizationId), eq(inventoryBalances.storeId, s.storeId))),
    );
    const active = await withScope(scope, (tx) =>
      tx.select({ id: inventoryReservations.id, quantity: inventoryReservations.quantity }).from(inventoryReservations).where(and(eq(inventoryReservations.organizationId, s.organizationId), eq(inventoryReservations.status, "active"))),
    );
    expect(active).toEqual([{ id: third.id, quantity: "4.000" }]);
    expect(balance.reserved).toBe("4.000");
  });

  it("does not expose reservations to another organization", async () => {
    const s = await setup();
    await withScope({ organizationId: s.organizationId }, (tx) =>
      reserveStock(tx, s.organizationId, { storeId: s.storeId, variantId: s.variantId, quantityMilli: milli(1), source: "sale", sourceId: randomUUID(), actorUserId: s.ownerId }),
    );
    const other = await createOrganizationFixture();
    const seen = await withScope({ organizationId: other.organizationId }, (tx) => tx.select({ id: inventoryReservations.id }).from(inventoryReservations));
    expect(seen).toHaveLength(0);
  });
});
