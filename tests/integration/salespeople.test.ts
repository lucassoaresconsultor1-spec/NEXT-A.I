import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withScope } from "@/db/tenant";
import { saveHoliday } from "@/server/calendar/service";
import { recordMovement } from "@/server/inventory/service";
import { completeSale } from "@/server/sales/complete";
import { setSchedule, workingDays } from "@/server/salespeople/schedules";
import { listSalespeople, saveSalesperson, setSalespersonActive } from "@/server/salespeople/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

async function setup() {
  const org = await createOrganizationFixture();
  const storeA = await createStoreFixture(org.organizationId);
  const storeB = await createStoreFixture(org.organizationId);
  const manager = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeA] });
  const seller = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [storeA, storeB] });
  return { ...org, storeA, storeB, manager, seller };
}

describe("salespeople", () => {
  it("registers lower-level members for stores in both scopes and keeps codes unique", async () => {
    const s = await setup();
    const created = await saveSalesperson(s.manager.context, { membershipId: s.seller.membershipId, code: "v01", nickname: "Ana", storeIds: [s.storeA] });
    await expect(saveSalesperson(s.manager.context, { membershipId: s.seller.membershipId, code: "V02", nickname: "Ana", storeIds: [s.storeA] })).rejects.toMatchObject({ code: "conflict" });
    await expect(saveSalesperson(s.manager.context, { membershipId: s.seller.membershipId, code: "V01", nickname: "Ana", storeIds: [s.storeB] }, created.id)).rejects.toMatchObject({ code: "not_found" });

    const limited = await addMemberFixture(s.organizationId, { roleKey: "salesperson", storeIds: [s.storeB] });
    await expect(saveSalesperson(s.owner, { membershipId: limited.membershipId, code: "V02", nickname: "Beto", storeIds: [s.storeA] })).rejects.toMatchObject({ fieldErrors: { storeIds: expect.any(Array) } });
    await expect(saveSalesperson(s.owner, { membershipId: limited.membershipId, code: "V01", nickname: "Beto", storeIds: [s.storeB] })).rejects.toMatchObject({ code: "conflict" });
    const peer = await addMemberFixture(s.organizationId, { roleKey: "store_manager", storeIds: [s.storeA] });
    await expect(saveSalesperson(s.manager.context, { membershipId: peer.membershipId, code: "G01", nickname: "Par", storeIds: [s.storeA] })).rejects.toMatchObject({ code: "forbidden" });

    // The owner adds store B; the store manager (scope A) edits without removing it.
    await saveSalesperson(s.owner, { membershipId: s.seller.membershipId, code: "V01", nickname: "Ana", storeIds: [s.storeA, s.storeB] }, created.id);
    await saveSalesperson(s.manager.context, { membershipId: s.seller.membershipId, code: "V01", nickname: "Ana Paula", storeIds: [s.storeA] }, created.id);
    const full = (await listSalespeople(s.owner, { page: 1 })).rows;
    expect(full).toEqual([expect.objectContaining({ code: "V01", nickname: "Ana Paula", storeIds: [s.storeA, s.storeB].sort() })]);
    expect((await listSalespeople(s.manager.context, { page: 1 })).rows[0].storeIds).toEqual([s.storeA]);

    const other = await createOrganizationFixture();
    expect((await listSalespeople(other.owner, { page: 1 })).rows).toEqual([]);
    await expect(setSalespersonActive(other.owner, created.id, false)).rejects.toMatchObject({ code: "not_found" });
  });

  it("counts working days from the store calendar minus the days off", async () => {
    const s = await setup();
    const { id } = await saveSalesperson(s.owner, { membershipId: s.seller.membershipId, code: "V01", nickname: "Ana", storeIds: [s.storeA] });
    await saveHoliday(s.owner, { day: "2027-01-20", name: "São Sebastião", kind: "holiday" });
    await setSchedule(s.manager.context, { salespersonId: id, storeId: s.storeA, month: "2027-01", daysOff: ["2027-01-08", "2027-01-15", "2027-01-16"] });
    await expect(setSchedule(s.manager.context, { salespersonId: id, storeId: s.storeB, month: "2027-01", daysOff: [] })).rejects.toMatchObject({ code: "not_found" });
    await expect(setSchedule(s.owner, { salespersonId: id, storeId: s.storeB, month: "2027-01", daysOff: [] })).rejects.toMatchObject({ code: "not_found" });
    // 21 weekdays - 01/01 - 20/01 - two weekday days off (16/01 is a Saturday).
    const days = await withScope({ organizationId: s.organizationId }, (tx) => workingDays(tx, s.organizationId, id, s.storeA, "2027-01-01", "2027-01-31"));
    expect(days).toBe(17);
  });

  it("only accepts active salespeople of the store in sales once salespeople are registered", async () => {
    const s = await setup();
    const { variantId } = await createVariantFixture(s.organizationId);
    await setPriceFixture(s.organizationId, variantId, 1000);
    await recordMovement(s.owner, { storeId: s.storeA, variantId, type: "entry", quantity: "10", reason: "Estoque" });
    const cashier = await addMemberFixture(s.organizationId, { roleKey: "cashier", storeIds: [s.storeA] });
    await openCashSessionFixture(s.organizationId, s.storeA, cashier.userId, 0);
    const sale = (salespersonUserId: string) =>
      completeSale(cashier.context, {
        completionKey: randomUUID(),
        storeId: s.storeA,
        salespersonUserId,
        items: [{ variantId, quantity: "1", expectedUnitPriceCents: 1000 }],
        payments: [{ method: "cash", amountCents: 1000, tenderedCents: 1000 }],
      });
    // No salespeople registered yet: any active member that reaches the store.
    await expect(sale(cashier.userId)).resolves.toMatchObject({ replayed: false });
    const { id } = await saveSalesperson(s.owner, { membershipId: s.seller.membershipId, code: "V01", nickname: "Ana", storeIds: [s.storeA] });
    await expect(sale(s.seller.userId)).resolves.toMatchObject({ replayed: false });
    await expect(sale(cashier.userId)).rejects.toMatchObject({ fieldErrors: { salespersonUserId: expect.any(Array) } });
    await setSalespersonActive(s.manager.context, id, false);
    await expect(sale(s.seller.userId)).rejects.toMatchObject({ fieldErrors: { salespersonUserId: expect.any(Array) } });
  });
});
