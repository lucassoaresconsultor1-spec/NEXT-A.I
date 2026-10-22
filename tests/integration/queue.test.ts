import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recordMovement } from "@/server/inventory/service";
import { departments } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { setSalespersonDepartments } from "@/server/queue/departments";
import { abandonEntry, assignManual, callNext, finishAttendance, getQueue, queueStats, registerArrival, setPresence } from "@/server/queue/service";
import { completeSale } from "@/server/sales/complete";
import { saveSalesperson } from "@/server/salespeople/service";
import { todayIn } from "@/server/targets/schemas";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

describe("service queue", () => {
  it("distributes by rotation, links sales, measures conversion and keeps roles and scope", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const reception = (await addMemberFixture(organizationId, { roleKey: "reception", storeIds: [storeId] })).context;
    const manager = (await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeId] })).context;
    const sellers = [await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] }), await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] })];
    const [ana, beto] = await Promise.all(sellers.map((seller, index) => saveSalesperson(owner, { membershipId: seller.membershipId, code: `V0${index + 1}`, nickname: `V${index}`, storeIds: [storeId] })));
    const { variantId } = await createVariantFixture(organizationId);
    await setPriceFixture(organizationId, variantId, 1000);
    await recordMovement(owner, { storeId, variantId, type: "entry", quantity: "10", reason: "Estoque" });
    const cashier = await addMemberFixture(organizationId, { roleKey: "cashier", storeIds: [storeId] });
    await openCashSessionFixture(organizationId, storeId, cashier.userId, 0);
    const sellAs = async (salespersonUserId: string) =>
      (
        await completeSale(cashier.context, {
          completionKey: randomUUID(),
          storeId,
          salespersonUserId,
          items: [{ variantId, quantity: "1", expectedUnitPriceCents: 1000 }],
          payments: [{ method: "cash", amountCents: 1000, tenderedCents: 1000 }],
        })
      ).saleId;
    const arrive = () => registerArrival(reception, { storeId, requestKey: randomUUID() });

    await setPresence(sellers[0].context, { storeId, salespersonId: ana.id, status: "available" });
    await setPresence(sellers[1].context, { storeId, salespersonId: beto.id, status: "available" });
    await expect(setPresence(sellers[0].context, { storeId, salespersonId: beto.id, status: "away" })).rejects.toMatchObject({ code: "forbidden" });
    const key = randomUUID();
    const a = await registerArrival(reception, { storeId, requestKey: key, note: "Camisa azul" });
    expect(await registerArrival(reception, { storeId, requestKey: key })).toEqual({ ...a, replayed: true });
    const b = await arrive();
    expect([a.ticket, b.ticket]).toEqual([1, 2]);

    // Rotation: Ana waits the longest, then Beto; with nobody available the call is refused.
    expect(await callNext(reception, { storeId })).toEqual({ entryId: a.id, salespersonId: ana.id });
    expect(await callNext(reception, { storeId })).toEqual({ entryId: b.id, salespersonId: beto.id });
    const c = await arrive();
    await expect(callNext(reception, { storeId })).rejects.toMatchObject({ code: "invalid" });

    const anaSale = await sellAs(sellers[0].userId);
    const betoSale = await sellAs(sellers[1].userId);
    await expect(finishAttendance(sellers[0].context, a.id, { outcome: "sale", saleId: betoSale })).rejects.toMatchObject({ fieldErrors: { saleId: expect.any(Array) } });
    await expect(finishAttendance(sellers[0].context, b.id, { outcome: "no_sale", reason: "Só olhando" })).rejects.toMatchObject({ code: "forbidden" });
    await finishAttendance(sellers[0].context, a.id, { outcome: "sale", saleId: anaSale });
    await finishAttendance(sellers[1].context, b.id, { outcome: "no_sale", reason: "Só olhando" });
    // Ana finished first, so she is called again before Beto.
    expect(await callNext(reception, { storeId })).toMatchObject({ entryId: c.id, salespersonId: ana.id });

    const d = await arrive();
    await expect(assignManual(reception, d.id, { salespersonId: beto.id, reason: "Cliente pediu" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(assignManual(manager, d.id, { salespersonId: ana.id, reason: "Cliente pediu" })).rejects.toMatchObject({ code: "invalid" });
    await assignManual(manager, d.id, { salespersonId: beto.id, reason: "Cliente pediu" });
    await expect(finishAttendance(sellers[0].context, c.id, { outcome: "sale", saleId: anaSale })).rejects.toMatchObject({ fieldErrors: { saleId: expect.any(Array) } });
    await finishAttendance(reception, c.id, { outcome: "no_sale", reason: "Sem tamanho" });
    await finishAttendance(sellers[1].context, d.id, { outcome: "no_sale", reason: "Preço" });
    const e = await arrive();
    await abandonEntry(reception, e.id, { reason: "Foi embora" });

    // Concurrent calls never repeat a customer or a salesperson.
    await Promise.all([arrive(), arrive()]);
    const calls = await Promise.all([callNext(reception, { storeId }), callNext(reception, { storeId })]);
    expect(new Set(calls.map((call) => call?.entryId)).size).toBe(2);
    expect(new Set(calls.map((call) => call?.salespersonId)).size).toBe(2);
    expect((await getQueue(reception, storeId)).entries.filter((entry) => entry.status === "in_service")).toHaveLength(2);

    const today = todayIn("America/Sao_Paulo");
    expect(await queueStats(manager, { storeId, from: today, to: today })).toEqual({ finished: 4, withSale: 1, noSale: 3, abandoned: 1, conversion: "25.0" });

    const otherStore = await createStoreFixture(organizationId);
    await expect(getQueue(reception, otherStore)).rejects.toMatchObject({ code: "not_found" });
    const other = await createOrganizationFixture();
    await expect(getQueue(other.owner, storeId)).rejects.toMatchObject({ code: "not_found" });
    await expect(abandonEntry(other.owner, c.id, { reason: "Invasão" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("calls only salespeople of the requested sector, even before others waiting longer", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const reception = (await addMemberFixture(organizationId, { roleKey: "reception", storeIds: [storeId] })).context;
    const sellers = [await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] }), await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] })];
    const [ana, beto] = await Promise.all(sellers.map((seller, index) => saveSalesperson(owner, { membershipId: seller.membershipId, code: `S0${index + 1}`, nickname: `S${index}`, storeIds: [storeId] })));
    const [shoes] = await withScope({ organizationId }, (tx) => tx.insert(departments).values({ organizationId, name: "Calçados" }).returning({ id: departments.id }));
    await setSalespersonDepartments(owner, beto.id, { departmentIds: [shoes.id] });
    await setPresence(owner, { storeId, salespersonId: ana.id, status: "available" });
    await setPresence(owner, { storeId, salespersonId: beto.id, status: "available" });
    const first = await registerArrival(reception, { storeId, requestKey: randomUUID(), departmentId: shoes.id });
    expect(await callNext(reception, { storeId })).toEqual({ entryId: first.id, salespersonId: beto.id });
    await registerArrival(reception, { storeId, requestKey: randomUUID(), departmentId: shoes.id });
    await expect(callNext(reception, { storeId })).rejects.toMatchObject({ message: "Nenhum vendedor deste setor disponível." });
  });
});
