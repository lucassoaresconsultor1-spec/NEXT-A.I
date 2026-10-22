import { describe, expect, it } from "vitest";
import { withScope } from "@/db/tenant";
import { cancelExpense, createExpense, listExpenses, payExpense, saveCategory, setCategoryActive, sumExpensesInTx, updateExpense } from "@/server/expenses/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture } from "./fixtures";

describe("expenses", () => {
  it("totals by competence without cancelled ones, edits only open expenses and respects roles and scope", async () => {
    const { organizationId } = await createOrganizationFixture();
    const storeA = await createStoreFixture(organizationId);
    const storeB = await createStoreFixture(organizationId);
    const finance = (await addMemberFixture(organizationId, { roleKey: "finance", storeAccess: "all" })).context;
    const manager = (await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeA] })).context;
    const rent = await saveCategory(finance, { name: "Aluguel" });
    const old = await saveCategory(finance, { name: "Antiga" });
    await expect(saveCategory(finance, { name: "aluguel" })).rejects.toMatchObject({ code: "conflict" });
    await setCategoryActive(finance, old.id, false);

    const base = { storeId: storeA, categoryId: rent.id, description: "Aluguel de março", competenceDate: "2027-03-01" };
    const march = await createExpense(finance, { ...base, amountCents: 300_000 });
    const energy = await createExpense(finance, { ...base, description: "Energia", amountCents: 45_000, competenceDate: "2027-03-20" });
    await createExpense(finance, { ...base, storeId: storeB, amountCents: 200_000 });
    await createExpense(finance, { ...base, amountCents: 1_000, competenceDate: "2027-04-01" });
    await expect(createExpense(finance, { ...base, categoryId: old.id, amountCents: 1 })).rejects.toMatchObject({ fieldErrors: { categoryId: expect.any(Array) } });
    await expect(createExpense(manager, { ...base, amountCents: 1 })).rejects.toMatchObject({ code: "forbidden" });

    await updateExpense(finance, march.id, { ...base, amountCents: 310_000 });
    await payExpense(finance, march.id, { paidOn: "2027-03-05" });
    await expect(updateExpense(finance, march.id, { ...base, amountCents: 1 })).rejects.toMatchObject({ code: "invalid" });
    await cancelExpense(finance, energy.id, { reason: "Lançada em duplicidade" });

    const period = { from: "2027-03-01", to: "2027-03-31" };
    expect((await listExpenses(finance, { ...period, page: 1 })).totalCents).toBe(510_000);
    const managerView = await listExpenses(manager, { ...period, page: 1 });
    expect(managerView).toMatchObject({ total: 2, totalCents: 310_000 });
    expect(await withScope({ organizationId }, (tx) => sumExpensesInTx(tx, organizationId, { ...period, storeIds: [storeA] }))).toBe(310_000);

    const other = await createOrganizationFixture();
    expect((await listExpenses(other.owner, { ...period, page: 1 })).total).toBe(0);
    await expect(cancelExpense(other.owner, march.id, { reason: "Invasão" })).rejects.toMatchObject({ code: "not_found" });
  });
});
