import { describe, expect, it } from "vitest";
import { parseQuantityInput } from "./quantity";
import { movementFiltersSchema, movementInputSchema } from "./schemas";

const STORE_ID = "5f0c6d1e-8a51-4c5e-9f41-2b7a0c3d9e10";
const VARIANT_ID = "8d2b1f0a-3c4e-4f5a-9b6c-7d8e9f0a1b2c";
const base = { storeId: STORE_ID, variantId: VARIANT_ID, reason: "Recebimento da nota 123" };

function quantityIssue(input: Record<string, unknown>) {
  const result = movementInputSchema.safeParse({ ...base, ...input });
  return result.success ? null : result.error.issues.find((issue) => issue.path[0] === "quantity")?.message;
}

describe("movementInputSchema", () => {
  it("parses the informed quantity into thousandths", () => {
    const parsed = movementInputSchema.parse({ ...base, type: "entry", quantity: "2,5" });
    expect(parsed).toEqual({ ...base, type: "entry", quantityMilli: parseQuantityInput("2.5") });
    expect(movementInputSchema.parse({ ...base, type: "entry", quantity: 3 }).quantityMilli).toBe(parseQuantityInput("3"));
  });

  it("requires positive quantities for entry, exit and loss", () => {
    for (const type of ["entry", "exit", "loss"]) {
      expect(quantityIssue({ type, quantity: "0" })).toBe("Informe uma quantidade maior que zero.");
      expect(quantityIssue({ type, quantity: "-1" })).toBe("Informe uma quantidade maior que zero.");
    }
  });

  it("accepts signed adjustments but not zero", () => {
    expect(quantityIssue({ type: "adjustment", quantity: "-2" })).toBeNull();
    expect(quantityIssue({ type: "adjustment", quantity: "0" })).toMatch(/diferente de zero/);
  });

  it("accepts a count of zero but not a negative count", () => {
    expect(quantityIssue({ type: "count", quantity: "0" })).toBeNull();
    expect(quantityIssue({ type: "count", quantity: "-1" })).toMatch(/zero ou mais/);
  });

  it("rejects malformed quantities, unknown types and short reasons", () => {
    expect(quantityIssue({ type: "entry", quantity: "1.2345" })).toMatch(/3 decimais/);
    expect(quantityIssue({ type: "entry", quantity: 0.1 + 0.2 })).toMatch(/3 decimais/);
    const result = movementInputSchema.safeParse({ ...base, type: "sale", quantity: "1", reason: "x", storeId: "loja" });
    expect(result.success).toBe(false);
    expect(new Set(result.error?.issues.map((issue) => issue.path[0]))).toEqual(new Set(["type", "reason", "storeId"]));
  });
});

describe("movementFiltersSchema", () => {
  it("falls back to safe defaults", () => {
    expect(movementFiltersSchema.parse({ storeId: "x", type: "sale", from: "ontem", page: "0" })).toEqual({
      storeId: undefined,
      variantId: undefined,
      type: undefined,
      from: undefined,
      to: undefined,
      page: 1,
    });
  });
});
