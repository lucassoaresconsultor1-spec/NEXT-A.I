import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { organizationMemberships, reportRuns, reportSchedules } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { createExpense, saveCategory } from "@/server/expenses/service";
import { recordMovement } from "@/server/inventory/service";
import { runDueSchedules, saveSchedule } from "@/server/reports/schedules";
import { getRunCsv, listRuns, runReport } from "@/server/reports/service";
import { completeSale } from "@/server/sales/complete";
import { todayIn } from "@/server/targets/schemas";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

describe("reports", () => {
  it("exports CSV from the services as the member, keeps a private history and runs schedules as their owner", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeA = await createStoreFixture(organizationId);
    const storeB = await createStoreFixture(organizationId);
    const { variantId } = await createVariantFixture(organizationId);
    await setPriceFixture(organizationId, variantId, 1000);
    for (const [storeId, quantity] of [[storeA, 2], [storeB, 1]] as const) {
      await recordMovement(owner, { storeId, variantId, type: "entry", quantity: "5", reason: "Estoque" });
      const cashier = await addMemberFixture(organizationId, { roleKey: "cashier", storeIds: [storeId] });
      await openCashSessionFixture(organizationId, storeId, cashier.userId, 0);
      await completeSale(cashier.context, { completionKey: randomUUID(), storeId, items: [{ variantId, quantity: String(quantity), expectedUnitPriceCents: 1000 }], payments: [{ method: "cash", amountCents: quantity * 1000, tenderedCents: quantity * 1000 }] });
    }
    const finance = await addMemberFixture(organizationId, { roleKey: "finance", storeAccess: "all" });
    const managerB = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeB] });
    const cashier = await addMemberFixture(organizationId, { roleKey: "cashier", storeIds: [storeA] });
    const day = todayIn("America/Sao_Paulo");
    const params = { kind: "sales_by_store", from: day, to: day };

    const run = await runReport(finance.context, params);
    const csv = (await getRunCsv(finance.context, run.id))!.content;
    expect(csv.startsWith("﻿Loja;Bruto;Descontos;Cancelado;Devolvido;Líquido;Vendas;Ticket médio;Itens por venda\r\n")).toBe(true);
    expect(csv).toContain(";20,00;0,00;0,00;0,00;20,00;1;20,00;2,00\r\n");
    expect(csv).toContain(";10,00;0,00;0,00;0,00;10,00;1;10,00;1,00\r\n");
    const scoped = await runReport(managerB.context, params);
    expect(scoped.rowCount).toBe(1);
    await expect(runReport(cashier.context, params)).rejects.toMatchObject({ code: "forbidden" });
    await expect(runReport(managerB.context, { ...params, storeId: storeA })).rejects.toMatchObject({ code: "not_found" });
    expect(await getRunCsv(managerB.context, run.id)).toBeNull();
    expect((await listRuns(managerB.context)).rows.map((row) => row.id)).toEqual([scoped.id]);

    const category = await saveCategory(finance.context, { name: "Diversas" });
    await createExpense(finance.context, { storeId: storeA, categoryId: category.id, competenceDate: day, description: "=SOMA(1;2)", amountCents: 1990 });
    const expenses = await runReport(finance.context, { kind: "expenses", from: day, to: day });
    expect((await getRunCsv(finance.context, expenses.id))!.content).toContain(`"'=SOMA(1;2)";19,90;`);

    // Schedules run as their owner; a suspended owner produces a failed run without data.
    const schedule = await saveSchedule(finance.context, { kind: "sales_by_store", period: "yesterday", frequency: "daily", hour: 6 });
    const due = async () => withScope({ organizationId }, (tx) => tx.update(reportSchedules).set({ nextRunAt: new Date(Date.now() - 60_000) }).where(eq(reportSchedules.id, schedule.id)));
    await due();
    const first = await runDueSchedules();
    expect(first.ran).toBeGreaterThanOrEqual(1);
    const [after] = await withScope({ organizationId }, (tx) => tx.select({ nextRunAt: reportSchedules.nextRunAt }).from(reportSchedules).where(eq(reportSchedules.id, schedule.id)));
    expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    await withScope({ organizationId }, (tx) => tx.update(organizationMemberships).set({ status: "suspended" }).where(eq(organizationMemberships.id, finance.membershipId)));
    await due();
    await runDueSchedules();
    const runs = await withScope({ organizationId }, (tx) => tx.select({ status: reportRuns.status, content: reportRuns.content }).from(reportRuns).where(and(eq(reportRuns.organizationId, organizationId), eq(reportRuns.scheduleId, schedule.id))));
    expect(runs.map((row) => row.status).sort()).toEqual(["done", "failed"]);
    expect(runs.find((row) => row.status === "failed")?.content).toBeNull();

    const other = await createOrganizationFixture();
    expect(await getRunCsv(other.owner, run.id)).toBeNull();
  });
});
