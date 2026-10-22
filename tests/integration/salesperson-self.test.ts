import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recordMovement } from "@/server/inventory/service";
import { salesSummary } from "@/server/metrics/sales";
import { completeSale } from "@/server/sales/complete";
import { ownSalesMetrics, ownSalesperson } from "@/server/salespeople/self";
import { saveSalesperson } from "@/server/salespeople/service";
import { monthRange, todayIn } from "@/server/targets/schemas";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

const month = todayIn("America/Sao_Paulo").slice(0, 7);

describe("salesperson's own view", () => {
  it("counts only the sales recorded with me as salesperson and derives me from the session", async () => {
    const org = await createOrganizationFixture();
    const storeA = await createStoreFixture(org.organizationId);
    const manager = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeA] });
    const seller = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [storeA] });
    const colleague = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [storeA] });
    const outsider = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [storeA] });
    const { id: salespersonId } = await saveSalesperson(org.owner, { membershipId: seller.membershipId, code: "V01", nickname: "Ana", storeIds: [storeA] });
    await saveSalesperson(org.owner, { membershipId: colleague.membershipId, code: "V02", nickname: "Bia", storeIds: [storeA] });

    const { variantId } = await createVariantFixture(org.organizationId);
    await setPriceFixture(org.organizationId, variantId, 1000);
    await recordMovement(org.owner, { storeId: storeA, variantId, type: "entry", quantity: "10", reason: "Estoque" });
    await openCashSessionFixture(org.organizationId, storeA, manager.userId, 0);
    const sell = (salespersonUserId: string | undefined, quantity: number) =>
      completeSale(manager.context, {
        completionKey: randomUUID(),
        storeId: storeA,
        salespersonUserId,
        items: [{ variantId, quantity: String(quantity), expectedUnitPriceCents: 1000 }],
        payments: [{ method: "cash", amountCents: 1000 * quantity, tenderedCents: 1000 * quantity }],
      });
    await sell(seller.userId, 2);
    await sell(colleague.userId, 3);
    await sell(undefined, 1);

    // The general metrics refuse a salesperson (no sales.read nor sales.create).
    await expect(salesSummary(seller.context, monthRange(month))).rejects.toMatchObject({ code: "forbidden" });
    expect(await ownSalesperson(seller.context)).toEqual({ id: salespersonId, code: "V01", nickname: "Ana", storeIds: [storeA] });
    expect(await ownSalesMetrics(seller.context, monthRange(month))).toMatchObject({ netRevenueCents: 2000, saleCount: 1 });
    expect(await ownSalesMetrics(colleague.context, monthRange(month))).toMatchObject({ netRevenueCents: 3000, saleCount: 1 });
    // A member without a salesperson record, and another organization, see nothing.
    expect(await ownSalesperson(outsider.context)).toBeNull();
    expect(await ownSalesMetrics(outsider.context, monthRange(month))).toBeNull();
    const other = await createOrganizationFixture();
    expect(await ownSalesperson(other.owner)).toBeNull();
  });
});
