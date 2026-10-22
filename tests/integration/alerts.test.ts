import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cashSessions, dailyClosings } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { assignAlert, evaluateNow, listAlerts, resolveAlert, saveRule } from "@/server/alerts/service";
import { recordMovement } from "@/server/inventory/service";
import { abandonEntry, registerArrival } from "@/server/queue/service";
import { todayIn } from "@/server/targets/schemas";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture } from "./fixtures";

describe("alerts", () => {
  it("runs only configured rules, deduplicates, resolves state alerts by itself and keeps scope", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeA = await createStoreFixture(organizationId);
    const storeB = await createStoreFixture(organizationId);
    const { variantId } = await createVariantFixture(organizationId);
    await recordMovement(owner, { storeId: storeA, variantId, type: "entry", quantity: "2", reason: "Estoque" });
    await recordMovement(owner, { storeId: storeB, variantId, type: "entry", quantity: "10", reason: "Estoque" });
    const managerA = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeA] });
    const managerB = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeB] });

    expect(await evaluateNow(owner)).toEqual({ raised: 0 });
    await expect(saveRule(owner, "low_stock", { enabled: true, severity: "warning" })).rejects.toMatchObject({ fieldErrors: { threshold: expect.any(Array) } });
    await expect(saveRule(managerA.context, "low_stock", { enabled: true, severity: "warning", threshold: 3000 })).rejects.toMatchObject({ code: "forbidden" });
    await saveRule(owner, "low_stock", { enabled: true, severity: "warning", threshold: 3000 });
    expect(await evaluateNow(owner)).toEqual({ raised: 1 });
    expect(await evaluateNow(owner)).toEqual({ raised: 0 });
    expect((await listAlerts(managerA.context, { status: "open" })).rows).toEqual([expect.objectContaining({ kind: "low_stock", storeId: storeA })]);
    expect((await listAlerts(managerB.context)).rows).toEqual([]);

    // Restocking resolves the state alert on the next evaluation.
    await recordMovement(owner, { storeId: storeA, variantId, type: "entry", quantity: "5", reason: "Reposição" });
    await evaluateNow(owner);
    expect((await listAlerts(owner)).rows).toEqual([expect.objectContaining({ kind: "low_stock", status: "resolved", resolvedBy: null })]);

    // Cash difference, queue abandonment and divergent reconciliation.
    const cashier = await addMemberFixture(organizationId, { roleKey: "cashier", storeIds: [storeA] });
    const sessionId = await openCashSessionFixture(organizationId, storeA, cashier.userId, 0);
    await withScope({ organizationId }, (tx) =>
      tx.update(cashSessions).set({ status: "closed", closedAt: new Date(), countedAmountCents: 0, expectedAmountCents: 500, differenceCents: -500 }).where(eq(cashSessions.id, sessionId)),
    );
    const reception = await addMemberFixture(organizationId, { roleKey: "reception", storeIds: [storeB] });
    const entry = await registerArrival(reception.context, { storeId: storeB, requestKey: randomUUID() });
    await abandonEntry(reception.context, entry.id, { reason: "Foi embora" });
    await withScope({ organizationId }, (tx) =>
      tx.insert(dailyClosings).values({ organizationId, storeId: storeB, day: todayIn("America/Sao_Paulo"), version: 1, saleCount: 0, salesCents: 0, cancelledCents: 0, returnedCents: 0, cashCents: 0, cardExternalCents: 0, pixCents: 0, cardProviderCents: 0, cashDifferenceCents: 0, reconciliation: "divergent", reconciledCount: 0, divergentCount: 1 }),
    );
    await saveRule(owner, "cash_difference", { enabled: true, severity: "critical", threshold: 100 });
    await saveRule(owner, "queue_abandonment", { enabled: true, severity: "info", threshold: 1 });
    await saveRule(owner, "reconciliation_divergent", { enabled: true, severity: "critical" });
    expect(await evaluateNow(owner)).toEqual({ raised: 3 });
    const open = (await listAlerts(owner, { status: "open" })).rows;
    expect(open.map((alert) => alert.kind).sort()).toEqual(["cash_difference", "queue_abandonment", "reconciliation_divergent"]);

    const cash = open.find((alert) => alert.kind === "cash_difference")!;
    await expect(assignAlert(managerA.context, cash.id, managerB.membershipId)).rejects.toMatchObject({ code: "invalid" });
    await assignAlert(managerA.context, cash.id, managerA.membershipId);
    await expect(resolveAlert(managerA.context, cash.id, { note: "" })).rejects.toMatchObject({ code: "invalid" });
    await resolveAlert(managerA.context, cash.id, { note: "Troco conferido com o operador" });
    await expect(resolveAlert(managerA.context, cash.id, { note: "De novo" })).rejects.toMatchObject({ code: "invalid" });
    // Event alerts do not come back once resolved by a person.
    expect(await evaluateNow(owner)).toEqual({ raised: 0 });

    const other = await createOrganizationFixture();
    expect((await listAlerts(other.owner)).rows).toEqual([]);
    await expect(resolveAlert(other.owner, cash.id, { note: "Invasão" })).rejects.toMatchObject({ code: "not_found" });
  });
});
