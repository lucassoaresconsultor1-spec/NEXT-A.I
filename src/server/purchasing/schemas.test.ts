import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { purchaseOrderFiltersSchema, purchaseOrderInputSchema, receiptInputSchema } from "./schemas";

const item = (values: Record<string, unknown> = {}) => ({ variantId: randomUUID(), quantity: "1", unitCostCents: 100, ...values });
const order = (items: unknown[]) => ({ storeId: randomUUID(), supplierId: randomUUID(), items });

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("purchaseOrderInputSchema", () => {
  it("converts quantities to thousandths and keeps cents", () => {
    const parsed = purchaseOrderInputSchema.parse(order([item({ quantity: "2,5", unitCostCents: "1290" })]));
    expect(parsed.items[0]).toMatchObject({ quantity: BigInt(2500), unitCostCents: 1290 });
    expect(parsed.expectedDate).toBeUndefined();
  });

  it.each(["0", "-1", "123456789012", "abc", "1,2345"])("rejects the quantity %j", (quantity) => {
    expect(issuePaths(purchaseOrderInputSchema.safeParse(order([item({ quantity })])))).toEqual(["items.0.quantity"]);
  });

  it("rejects negative and fractional costs", () => {
    expect(issuePaths(purchaseOrderInputSchema.safeParse(order([item({ unitCostCents: -1 })])))).toEqual(["items.0.unitCostCents"]);
    expect(issuePaths(purchaseOrderInputSchema.safeParse(order([item({ unitCostCents: 1.5 })])))).toEqual(["items.0.unitCostCents"]);
  });

  it("flags a repeated product on the repeated item", () => {
    const repeated = item();
    expect(issuePaths(purchaseOrderInputSchema.safeParse(order([repeated, { ...repeated }])))).toEqual(["items.1.variantId"]);
  });

  it("limits the number of items and requires at least one", () => {
    expect(purchaseOrderInputSchema.safeParse(order(Array.from({ length: 201 }, () => item()))).success).toBe(false);
    expect(purchaseOrderInputSchema.safeParse(order([])).success).toBe(false);
  });
});

describe("receiptInputSchema", () => {
  it("requires a UUID key and refuses repeated items", () => {
    const orderItemId = randomUUID();
    expect(receiptInputSchema.safeParse({ idempotencyKey: "abc", items: [{ orderItemId, quantity: "1" }] }).success).toBe(false);
    expect(
      issuePaths(receiptInputSchema.safeParse({ idempotencyKey: randomUUID(), items: [{ orderItemId, quantity: "1" }, { orderItemId, quantity: "2" }] })),
    ).toEqual(["items.1.orderItemId"]);
  });
});

describe("purchaseOrderFiltersSchema", () => {
  it("falls back to safe defaults", () => {
    expect(purchaseOrderFiltersSchema.parse({ status: "x", storeId: "y", number: "-3", page: "z" })).toEqual({
      status: undefined,
      storeId: undefined,
      supplierId: undefined,
      number: undefined,
      page: 1,
    });
    expect(purchaseOrderFiltersSchema.parse({ number: "12" }).number).toBe(12);
  });
});
