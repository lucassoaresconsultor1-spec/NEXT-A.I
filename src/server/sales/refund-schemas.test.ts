import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cancelSchema, effectiveLineCents, lineReturnCents, refundSchema } from "./refund-schemas";

const milli = (value: number) => BigInt(Math.round(value * 1000));

describe("refund schemas", () => {
  it("defaults restock on cancellations and validates the card NSU on returns", () => {
    expect(cancelSchema.parse({ idempotencyKey: randomUUID(), reason: "Cliente desistiu" }).restock).toBe(true);
    expect(cancelSchema.parse({ idempotencyKey: randomUUID(), reason: "Cliente desistiu", restock: "false" }).restock).toBe(false);
    const base = { idempotencyKey: randomUUID(), reason: "Defeito", items: [{ line: 1, quantity: "1" }] };
    expect(refundSchema.safeParse({ ...base, method: "card_external" }).success).toBe(false);
    expect(refundSchema.parse({ ...base, method: "card_external", nsu: "EST1234" }).items[0]).toMatchObject({ quantity: BigInt(1000), restock: false });
    expect(refundSchema.safeParse({ ...base, method: "cash", items: [{ line: 1, quantity: "1" }, { line: 1, quantity: "2" }] }).success).toBe(false);
    expect(refundSchema.safeParse({ ...base, method: "cash", items: [{ line: 1, quantity: "0" }] }).success).toBe(false);
  });
});

describe("allocation", () => {
  it("spreads the sale discount over the lines, rounding down", () => {
    // Lines of 2480 and 1771 (sum 4251) with a sale discount of 251 -> total 4000.
    expect(effectiveLineCents(2480, 4251, 4000)).toBe(2333);
    expect(effectiveLineCents(1771, 4251, 4000)).toBe(1666);
    expect(effectiveLineCents(1000, 0, 0)).toBe(0);
  });

  it("gives the rounding remainder to the return that completes the line", () => {
    const effective = 1000;
    const first = lineReturnCents(effective, milli(3), milli(0), 0, milli(1));
    const second = lineReturnCents(effective, milli(3), milli(1), first, milli(1));
    const last = lineReturnCents(effective, milli(3), milli(2), first + second, milli(1));
    expect([first, second, last]).toEqual([333, 333, 334]);
    expect(first + second + last).toBe(effective);
  });
});
