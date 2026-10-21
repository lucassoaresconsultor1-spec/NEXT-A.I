import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { auditLogs, cashMovements, inventoryBalances, inventoryMovements, organizations, plans, saleItems, salePayments, sales } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { recordMovement } from "@/server/inventory/service";
import { completeSale, findSaleByCompletionKey } from "@/server/sales/complete";
import { getSale, listSales } from "@/server/sales/queries";
import { getReceipt } from "@/server/sales/receipt";
import { updateOrganizationOperations } from "@/server/settings/service";
import {
  addMemberFixture,
  createCustomerFixture,
  createOrganizationFixture,
  createStoreFixture,
  createVariantFixture,
  openCashSessionFixture,
  setPriceFixture,
  uniqueSuffix,
} from "./fixtures";

async function setup() {
  const org = await createOrganizationFixture();
  const storeId = await createStoreFixture(org.organizationId);
  const otherStoreId = await createStoreFixture(org.organizationId);
  const a = await createVariantFixture(org.organizationId);
  const b = await createVariantFixture(org.organizationId, { unit: "kg" });
  await setPriceFixture(org.organizationId, a.variantId, 1290, 700);
  await setPriceFixture(org.organizationId, b.variantId, 4990);
  for (const [variantId, quantity] of [[a.variantId, "10"], [b.variantId, "5"]] as const) {
    await recordMovement(org.owner, { storeId, variantId, type: "entry", quantity, reason: "Estoque inicial" });
  }
  await updateOrganizationOperations(org.owner, { customerRequirement: "optional", maxDiscountBps: "10", receiptHeader: "Loja Teste", receiptFooter: "Volte sempre" });
  const cashierMember = await addMemberFixture(org.organizationId, { roleKey: "cashier", storeIds: [storeId] });
  const managerMember = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeId] });
  const sessionId = await openCashSessionFixture(org.organizationId, storeId, cashierMember.userId, 10000);
  return { ...org, storeId, otherStoreId, a, b, cashier: cashierMember.context, manager: managerMember.context, managerUserId: managerMember.userId, sessionId };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const sale = (s: Setup, values: Record<string, unknown> = {}) => ({
  completionKey: randomUUID(),
  storeId: s.storeId,
  items: [{ variantId: s.a.variantId, quantity: "1", expectedUnitPriceCents: 1290 }],
  payments: [{ method: "cash", amountCents: 1290, tenderedCents: 2000 }],
  ...values,
});

async function quantityOf(s: Setup, storeId: string, variantId: string) {
  const [row] = await withScope({ organizationId: s.organizationId }, (tx) =>
    tx
      .select({ quantity: inventoryBalances.quantity })
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.organizationId, s.organizationId), eq(inventoryBalances.storeId, storeId), eq(inventoryBalances.variantId, variantId))),
  );
  return row?.quantity ?? "0.000";
}

describe("sales: completion", () => {
  it("writes items with snapshots, mixed payments, stock exits, the cash movement and the store number", async () => {
    const s = await setup();
    const result = await completeSale(s.cashier, sale(s, {
      items: [
        { variantId: s.a.variantId, quantity: "2", expectedUnitPriceCents: 1290, discountCents: 100 },
        { variantId: s.b.variantId, quantity: "0,355", expectedUnitPriceCents: 4990 },
      ],
      payments: [
        { method: "cash", amountCents: 2000, tenderedCents: 5000 },
        { method: "card_external", amountCents: 2251, nsu: "ABC1234", brand: "Visa" },
      ],
    }));
    expect(result).toEqual({ saleId: expect.any(String), number: 1, totalCents: 4251, changeCents: 3000, replayed: false });
    expect(await quantityOf(s, s.storeId, s.a.variantId)).toBe("8.000");
    expect(await quantityOf(s, s.storeId, s.b.variantId)).toBe("4.645");

    const scope = { organizationId: s.organizationId };
    const [row] = await withScope(scope, (tx) => tx.select().from(sales).where(eq(sales.id, result.saleId)));
    expect(row).toMatchObject({ status: "completed", subtotalCents: 4351, discountCents: 100, surchargeCents: 0, totalCents: 4251, cashSessionId: s.sessionId, receiptHeader: "Loja Teste" });
    const items = await withScope(scope, (tx) => tx.select().from(saleItems).where(eq(saleItems.saleId, result.saleId)));
    expect(items.find((item) => item.variantId === s.a.variantId)).toMatchObject({ unitPriceCents: 1290, unitCostCents: 700, discountCents: 100, totalCents: 2480, quantity: "2.000" });
    expect(items.find((item) => item.variantId === s.b.variantId)).toMatchObject({ unitPriceCents: 4990, unitCostCents: null, totalCents: 1771 });
    const payments = await withScope(scope, (tx) => tx.select().from(salePayments).where(eq(salePayments.saleId, result.saleId)));
    expect(items.reduce((sum, item) => sum + item.totalCents, 0)).toBe(row.totalCents);
    expect(payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(row.totalCents);
    expect(payments.find((payment) => payment.method === "cash")).toMatchObject({ tenderedCents: 5000, changeCents: 3000, status: "confirmed" });

    const cash = await withScope(scope, (tx) => tx.select().from(cashMovements).where(and(eq(cashMovements.sessionId, s.sessionId), eq(cashMovements.type, "sale"))));
    expect(cash).toEqual([expect.objectContaining({ amountCents: 2000, referenceKind: "sale", referenceId: result.saleId })]);
    const exits = await withScope(scope, (tx) => tx.select({ reason: inventoryMovements.reason }).from(inventoryMovements).where(eq(inventoryMovements.type, "exit")));
    expect(exits).toEqual([{ reason: "Venda nº 1" }, { reason: "Venda nº 1" }]);
    const audit = await withScope(scope, (tx) => tx.select({ action: auditLogs.action, changes: auditLogs.changes }).from(auditLogs).where(eq(auditLogs.entityId, result.saleId)));
    expect(audit).toEqual([expect.objectContaining({ action: "sale.completed", changes: expect.objectContaining({ number: 1, totalCents: 4251 }) })]);
  });

  it("numbers sales per store", async () => {
    const s = await setup();
    expect((await completeSale(s.cashier, sale(s))).number).toBe(1);
    expect((await completeSale(s.cashier, sale(s))).number).toBe(2);
    await recordMovement(s.owner, { storeId: s.otherStoreId, variantId: s.a.variantId, type: "entry", quantity: "5", reason: "Estoque inicial" });
    const other = await addMemberFixture(s.organizationId, { roleKey: "cashier", storeIds: [s.otherStoreId] });
    await openCashSessionFixture(s.organizationId, s.otherStoreId, other.userId);
    expect((await completeSale(other.context, sale(s, { storeId: s.otherStoreId }))).number).toBe(1);
  });

  it("returns the same sale for a repeated completion key, sequentially and concurrently", async () => {
    const s = await setup();
    const input = sale(s);
    const first = await completeSale(s.cashier, input);
    expect(await completeSale(s.cashier, input)).toEqual({ ...first, replayed: true });
    expect(await findSaleByCompletionKey(s.cashier, input.completionKey)).toEqual({ saleId: first.saleId, number: first.number });

    const parallel = sale(s);
    const results = await Promise.all([completeSale(s.cashier, parallel), completeSale(s.cashier, parallel)]);
    expect(new Set(results.map((result) => result.saleId)).size).toBe(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(await quantityOf(s, s.storeId, s.a.variantId)).toBe("8.000");
    const cash = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx.select({ id: cashMovements.id }).from(cashMovements).where(and(eq(cashMovements.sessionId, s.sessionId), eq(cashMovements.type, "sale"))),
    );
    expect(cash).toHaveLength(2);
  });

  it("lets only one of two concurrent sales take the last units", async () => {
    const s = await setup();
    const second = await addMemberFixture(s.organizationId, { roleKey: "cashier", storeIds: [s.storeId] });
    await openCashSessionFixture(s.organizationId, s.storeId, second.userId);
    const take = { items: [{ variantId: s.a.variantId, quantity: "6", expectedUnitPriceCents: 1290 }], payments: [{ method: "cash", amountCents: 7740, tenderedCents: 7740 }] };
    const results = await Promise.allSettled([completeSale(s.cashier, sale(s, take)), completeSale(second.context, sale(s, take))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ fieldErrors: { "items.0.quantity": expect.any(Array) } });
    expect(await quantityOf(s, s.storeId, s.a.variantId)).toBe("4.000");
  });

  it("refuses stale prices, unauthorized discounts and surcharges, and payments that do not match", async () => {
    const s = await setup();
    await expect(completeSale(s.cashier, sale(s, { items: [{ variantId: s.a.variantId, quantity: "1", expectedUnitPriceCents: 1190 }], payments: [{ method: "cash", amountCents: 1190, tenderedCents: 1190 }] }))).rejects.toMatchObject({
      code: "conflict",
      fieldErrors: { "items.0.expectedUnitPriceCents": expect.any(Array) },
    });
    const bigDiscount = { saleDiscountCents: 200, payments: [{ method: "cash", amountCents: 1090, tenderedCents: 1090 }] };
    await expect(completeSale(s.cashier, sale(s, bigDiscount))).rejects.toMatchObject({ code: "forbidden" });
    await openCashSessionFixture(s.organizationId, s.storeId, s.managerUserId);
    await expect(completeSale(s.manager, sale(s, bigDiscount))).resolves.toMatchObject({ totalCents: 1090 });
    await expect(completeSale(s.cashier, sale(s, { surchargeCents: 10, payments: [{ method: "cash", amountCents: 1300, tenderedCents: 1300 }] }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(completeSale(s.cashier, sale(s, { payments: [{ method: "cash", amountCents: 1000, tenderedCents: 1000 }] }))).rejects.toMatchObject({ fieldErrors: { payments: expect.any(Array) } });
    await expect(completeSale(s.cashier, sale(s, { items: [{ variantId: s.a.variantId, quantity: "1", expectedUnitPriceCents: 1290, discountCents: 1300 }] }))).rejects.toMatchObject({
      fieldErrors: { "items.0.discountCents": expect.any(Array) },
    });
  });

  it("requires the operator's own open session and the store customer rule", async () => {
    const s = await setup();
    const noSession = await addMemberFixture(s.organizationId, { roleKey: "cashier", storeIds: [s.storeId] });
    await expect(completeSale(noSession.context, sale(s))).rejects.toMatchObject({ code: "invalid", message: "Abra o caixa antes de vender." });

    await updateOrganizationOperations(s.owner, { customerRequirement: "required", maxDiscountBps: "10", receiptHeader: "", receiptFooter: "" });
    await expect(completeSale(s.cashier, sale(s))).rejects.toMatchObject({ fieldErrors: { customerId: expect.any(Array) } });
    const inactive = await createCustomerFixture(s.organizationId, { isActive: false });
    await expect(completeSale(s.cashier, sale(s, { customerId: inactive }))).rejects.toMatchObject({ fieldErrors: { customerId: expect.any(Array) } });
    const active = await createCustomerFixture(s.organizationId, { name: "Cliente PDV", document: "52998224725" });
    const done = await completeSale(s.cashier, sale(s, { customerId: active }));
    expect((await getSale(s.cashier, done.saleId))?.customer).toEqual({ id: active, name: "Cliente PDV", document: "***.982.247-**" });
    expect((await getSale(s.manager, done.saleId))?.customer?.document).toBe("52998224725");
  });
});

describe("sales: reading, receipt and isolation", () => {
  it("shows operators only their own sales and builds the non-fiscal receipt", async () => {
    const s = await setup();
    const done = await completeSale(s.cashier, sale(s, { payments: [{ method: "card_external", amountCents: 1290, nsu: "NSU98765" }] }));
    const otherCashier = await addMemberFixture(s.organizationId, { roleKey: "cashier", storeIds: [s.storeId] });
    expect(await getSale(otherCashier.context, done.saleId)).toBeNull();
    expect((await listSales(otherCashier.context, {})).rows).toHaveLength(0);
    expect((await listSales(s.manager, {})).rows.map((row) => row.id)).toEqual([done.saleId]);

    const detail = await getSale(s.manager, done.saleId);
    expect(detail?.payments[0].nsu).toBe("••••8765");
    expect(detail?.items[0]).not.toHaveProperty("unitCostCents");
    expect((await getSale(s.owner, done.saleId))?.items[0]).toHaveProperty("unitCostCents", 700);

    const receipt = await getReceipt(s.cashier, done.saleId);
    expect(receipt).toMatchObject({ number: 1, header: "Loja Teste", footer: "Volte sempre", notice: "Documento sem valor fiscal", totalCents: 1290 });
  });

  it("isolates organizations and requires the pos feature", async () => {
    const s = await setup();
    const done = await completeSale(s.cashier, sale(s));
    const other = await createOrganizationFixture();
    expect(await getSale(other.owner, done.saleId)).toBeNull();
    for (const table of [sales, saleItems, salePayments]) {
      const seen = await withScope({ organizationId: other.organizationId }, (tx) => tx.select({ id: table.id }).from(table));
      expect(seen).toHaveLength(0);
    }
    const planKey = `sem_pdv_${uniqueSuffix()}`;
    await getDb().insert(plans).values({ key: planKey, name: "Sem PDV", description: "Plano de teste sem recursos" });
    await withScope({ organizationId: s.organizationId }, (tx) => tx.update(organizations).set({ planKey }).where(eq(organizations.id, s.organizationId)));
    await expect(completeSale(s.cashier, sale(s))).rejects.toMatchObject({ code: "limit" });
  });
});
