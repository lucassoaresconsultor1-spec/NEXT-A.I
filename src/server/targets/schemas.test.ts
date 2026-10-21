import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { monthRange, percentOf, projectionOf, targetInputSchema, todayIn } from "./schemas";

describe("target schemas", () => {
  it("keeps only the fields of the scope and requires them", () => {
    const storeId = randomUUID();
    expect(targetInputSchema.parse({ scope: "store", storeId, regionId: randomUUID(), month: "2027-02", amountCents: "500000" })).toMatchObject({
      storeId,
      regionId: null,
      salespersonId: null,
      amountCents: 500000,
    });
    expect(targetInputSchema.safeParse({ scope: "salesperson", storeId, month: "2027-02", amountCents: 1 }).success).toBe(false);
    expect(targetInputSchema.safeParse({ scope: "organization", month: "2027-13", amountCents: 1 }).success).toBe(false);
    expect(targetInputSchema.safeParse({ scope: "organization", month: "2027-02", amountCents: 0 }).success).toBe(false);
  });

  it("computes month ranges, percent and projection without floating point surprises", () => {
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(percentOf(12_345, 20_000)).toBe("61.7");
    expect(percentOf(30_000, 20_000)).toBe("150.0");
    expect(percentOf(-500, 20_000)).toBe("-2.5");
    expect(projectionOf(10_000, 5, 20)).toBe(40_000);
    expect(projectionOf(10_000, 0, 20)).toBe(0);
    expect(todayIn("America/Sao_Paulo", new Date("2027-01-01T02:00:00Z"))).toBe("2026-12-31");
  });
});
