import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { completeSaleSchema, saleFiltersSchema, suspendSaleSchema } from "./schemas";

const item = (values: Record<string, unknown> = {}) => ({ variantId: randomUUID(), quantity: "1", expectedUnitPriceCents: 1290, ...values });
const sale = (values: Record<string, unknown> = {}) => ({
  completionKey: randomUUID(),
  storeId: randomUUID(),
  items: [item()],
  payments: [{ method: "cash", amountCents: 1290, tenderedCents: 2000 }],
  ...values,
});
const paths = (result: { error?: { issues: { path: PropertyKey[] }[] } }) => result.error?.issues.map((issue) => issue.path.join(".")) ?? [];

describe("completeSaleSchema", () => {
  it("parses quantities and defaults", () => {
    const parsed = completeSaleSchema.parse(sale({ items: [item({ quantity: "0,355" })], customerId: "" }));
    expect(parsed.items[0]).toMatchObject({ quantity: BigInt(355), discountCents: 0 });
    expect(parsed).toMatchObject({ saleDiscountCents: 0, surchargeCents: 0, customerId: undefined });
  });

  it("refuses repeated products and zero quantities", () => {
    const repeated = item();
    expect(paths(completeSaleSchema.safeParse(sale({ items: [repeated, { ...repeated }] })))).toEqual(["items.1.variantId"]);
    expect(paths(completeSaleSchema.safeParse(sale({ items: [item({ quantity: "0" })] })))).toEqual(["items.0.quantity"]);
  });

  it("validates payments", () => {
    expect(paths(completeSaleSchema.safeParse(sale({ payments: [{ method: "cash", amountCents: 1290, tenderedCents: 1000 }] })))).toEqual(["payments.0.tenderedCents"]);
    expect(paths(completeSaleSchema.safeParse(sale({ payments: [{ method: "card_external", amountCents: 1290, nsu: "123" }] })))).toEqual(["payments.0.nsu"]);
    expect(completeSaleSchema.safeParse(sale({ payments: [{ method: "pix", amountCents: 1290 }] })).success).toBe(false);
    expect(completeSaleSchema.safeParse(sale({ payments: Array.from({ length: 11 }, () => ({ method: "card_external", amountCents: 1, nsu: "ABCD1234" })) })).success).toBe(false);
  });

  it("limits the number of items", () => {
    expect(completeSaleSchema.safeParse(sale({ items: Array.from({ length: 301 }, () => item()) })).success).toBe(false);
  });
});

describe("suspendSaleSchema and filters", () => {
  it("refuses repeated products when suspending", () => {
    const variantId = randomUUID();
    expect(paths(suspendSaleSchema.safeParse({ storeId: randomUUID(), items: [{ variantId, quantity: "1" }, { variantId, quantity: "2" }] }))).toEqual(["items.1.variantId"]);
  });

  it("falls back to safe filter defaults", () => {
    expect(saleFiltersSchema.parse({ status: "x", number: "abc", page: "-1" })).toMatchObject({ status: undefined, number: undefined, page: 1 });
  });
});
