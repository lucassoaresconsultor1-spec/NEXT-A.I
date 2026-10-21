import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dispatchSchema, receiveSchema, transferFiltersSchema, transferRequestSchema } from "./transfer-schemas";

const paths = (result: { error?: { issues: { path: PropertyKey[] }[] } }) => result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
const request = (values: Record<string, unknown> = {}) => ({
  originStoreId: randomUUID(),
  destinationStoreId: randomUUID(),
  items: [{ variantId: randomUUID(), quantity: "2,5" }],
  ...values,
});

describe("transferRequestSchema", () => {
  it("converts quantities to thousandths", () => {
    expect(transferRequestSchema.parse(request()).items[0].quantity).toBe(BigInt(2500));
  });

  it("refuses the same store as origin and destination", () => {
    const storeId = randomUUID();
    expect(paths(transferRequestSchema.safeParse(request({ originStoreId: storeId, destinationStoreId: storeId })))).toEqual(["destinationStoreId"]);
  });

  it("refuses repeated products and non-positive quantities", () => {
    const variantId = randomUUID();
    expect(paths(transferRequestSchema.safeParse(request({ items: [{ variantId, quantity: "1" }, { variantId, quantity: "2" }] })))).toEqual([
      "items.1.variantId",
    ]);
    expect(paths(transferRequestSchema.safeParse(request({ items: [{ variantId, quantity: "0" }] })))).toEqual(["items.0.quantity"]);
    expect(paths(transferRequestSchema.safeParse(request({ items: [{ variantId, quantity: "-1" }] })))).toEqual(["items.0.quantity"]);
  });
});

describe("dispatch and receive schemas", () => {
  it("accept zero but not negative quantities", () => {
    const itemId = randomUUID();
    expect(dispatchSchema.parse({ items: [{ itemId, quantitySent: "0" }] }).items[0].quantitySent).toBe(BigInt(0));
    expect(dispatchSchema.safeParse({ items: [{ itemId, quantitySent: "-1" }] }).success).toBe(false);
  });

  it("validates the divergence reason length and allows it to be empty", () => {
    expect(receiveSchema.safeParse({ items: [], divergenceReason: "ok" }).success).toBe(false);
    expect(receiveSchema.parse({ divergenceReason: "" }).divergenceReason).toBeUndefined();
  });

  it("falls back to safe filter defaults", () => {
    expect(transferFiltersSchema.parse({ status: "x", number: "abc" })).toEqual({ status: undefined, storeId: undefined, number: undefined, page: 1 });
  });
});
