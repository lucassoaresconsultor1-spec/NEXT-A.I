import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_CENTS } from "@/server/catalog/schemas";
import { closeSessionSchema, manualMovementSchema, openSessionSchema, sessionFiltersSchema } from "./schemas";

const open = (values: Record<string, unknown> = {}) => ({ registerId: randomUUID(), openingAmountCents: 10000, idempotencyKey: randomUUID(), ...values });
const movement = (values: Record<string, unknown> = {}) => ({ type: "supply", amountCents: 5000, reason: "Troco extra", idempotencyKey: randomUUID(), ...values });

describe("openSessionSchema", () => {
  it("accepts zero and integer strings", () => {
    expect(openSessionSchema.parse(open({ openingAmountCents: "0" })).openingAmountCents).toBe(0);
  });

  it.each([-1, 10.5, MAX_CENTS + 1])("rejects the amount %s", (openingAmountCents) => {
    expect(openSessionSchema.safeParse(open({ openingAmountCents })).success).toBe(false);
  });

  it("rejects a key that is not a UUID", () => {
    expect(openSessionSchema.safeParse(open({ idempotencyKey: "abc" })).success).toBe(false);
  });
});

describe("manualMovementSchema", () => {
  it("rejects zero, sale movements and short reasons", () => {
    expect(manualMovementSchema.safeParse(movement({ amountCents: 0 })).success).toBe(false);
    expect(manualMovementSchema.safeParse(movement({ type: "sale" })).success).toBe(false);
    expect(manualMovementSchema.safeParse(movement({ reason: "ok" })).success).toBe(false);
    expect(manualMovementSchema.parse(movement({ type: "withdrawal" })).type).toBe("withdrawal");
  });
});

describe("closeSessionSchema", () => {
  it("rejects negative counts and long notes", () => {
    expect(closeSessionSchema.safeParse({ countedAmountCents: -1 }).success).toBe(false);
    expect(closeSessionSchema.safeParse({ countedAmountCents: 0, note: "x".repeat(501) }).success).toBe(false);
    expect(closeSessionSchema.parse({ countedAmountCents: 100, note: "" }).note).toBeUndefined();
  });
});

describe("sessionFiltersSchema", () => {
  it("falls back to safe defaults", () => {
    expect(sessionFiltersSchema.parse({ status: "x", from: "2026-13-01", page: "a" })).toMatchObject({ status: undefined, from: undefined, page: 1 });
  });
});
