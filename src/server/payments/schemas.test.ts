import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canTransition, createIntentSchema } from "./schemas";

describe("createIntentSchema", () => {
  const valid = { storeId: randomUUID(), method: "pix", amountCents: 1290, idempotencyKey: randomUUID() };

  it("accepts provider methods only", () => {
    expect(createIntentSchema.parse(valid).method).toBe("pix");
    expect(createIntentSchema.safeParse({ ...valid, method: "cash" }).success).toBe(false);
  });

  it("rejects non-positive and fractional amounts", () => {
    expect(createIntentSchema.safeParse({ ...valid, amountCents: 0 }).success).toBe(false);
    expect(createIntentSchema.safeParse({ ...valid, amountCents: 1.5 }).success).toBe(false);
  });
});

describe("canTransition", () => {
  it.each([
    ["pending", "confirmed", true],
    ["pending", "failed", true],
    ["pending", "cancelled", true],
    ["confirmed", "refunded", true],
    ["confirmed", "failed", false],
    ["failed", "confirmed", false],
    ["refunded", "confirmed", false],
    ["cancelled", "confirmed", false],
  ])("%s -> %s = %s", (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });
});
