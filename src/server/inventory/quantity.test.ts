import { describe, expect, it } from "vitest";
import { fromDbQuantity, isWholeQuantity, ledgerEffect, parseQuantityInput, toDbQuantity } from "./quantity";

const q = (value: string) => parseQuantityInput(value)!;

describe("parseQuantityInput", () => {
  it.each([
    ["12", "12.000"],
    [" 0,5 ", "0.500"],
    ["3.25", "3.250"],
    ["-1,001", "-1.001"],
    ["99999999999.999", "99999999999.999"],
  ])("reads %j exactly", (input, canonical) => {
    expect(toDbQuantity(q(input))).toBe(canonical);
  });

  it.each(["", "abc", "1.2345", "1.000,5", "1e3", "+2", "123456789012"])("rejects %j", (input) => {
    expect(parseQuantityInput(input)).toBeNull();
  });
});

describe("database quantities", () => {
  it("round-trips numeric text without floating-point error", () => {
    expect(fromDbQuantity("0.100") + fromDbQuantity("0.200")).toBe(fromDbQuantity("0.300"));
    expect(toDbQuantity(fromDbQuantity("-3.000"))).toBe("-3.000");
    expect(toDbQuantity(fromDbQuantity("7"))).toBe("7.000");
  });

  it("refuses values with more than three decimals", () => {
    expect(() => fromDbQuantity("1.2345")).toThrow();
  });

  it("detects whole quantities", () => {
    expect(isWholeQuantity(q("4"))).toBe(true);
    expect(isWholeQuantity(q("4,5"))).toBe(false);
  });
});

describe("ledgerEffect", () => {
  const current = q("10");

  it("adds entries and positive adjustments, subtracts exits and losses", () => {
    expect(ledgerEffect("entry", q("2"), current)).toEqual({ delta: q("2"), balanceAfter: q("12"), counted: null });
    expect(ledgerEffect("exit", q("3"), current)).toEqual({ delta: q("-3"), balanceAfter: q("7"), counted: null });
    expect(ledgerEffect("loss", q("0,5"), current)).toEqual({ delta: q("-0,5"), balanceAfter: q("9,5"), counted: null });
    expect(ledgerEffect("adjustment", q("-4"), current)).toEqual({ delta: q("-4"), balanceAfter: q("6"), counted: null });
  });

  it("turns a physical count into the difference to the current balance", () => {
    expect(ledgerEffect("count", q("8"), current)).toEqual({ delta: q("-2"), balanceAfter: q("8"), counted: q("8") });
    expect(ledgerEffect("count", q("10"), current).delta).toBe(q("0"));
  });

  it("reports a negative result instead of hiding it (the service refuses it)", () => {
    expect(ledgerEffect("exit", q("11"), current).balanceAfter).toBe(q("-1"));
  });
});
