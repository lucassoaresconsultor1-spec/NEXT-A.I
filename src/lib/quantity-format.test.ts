import { describe, expect, it } from "vitest";
import { formatQuantity } from "./quantity-format";

describe("formatQuantity", () => {
  it.each([
    ["12.500", "12,5"],
    ["1234.000", "1.234"],
    ["1234567.125", "1.234.567,125"],
    ["-3.250", "-3,25"],
    ["0.000", "0"],
    ["5", "5"],
    ["0.001", "0,001"],
    ["-0.000", "0"],
  ])("formats %j", (input, expected) => {
    expect(formatQuantity(input)).toBe(expected);
  });

  it("appends the unit", () => {
    expect(formatQuantity("12.500", "kg")).toBe("12,5 kg");
    expect(formatQuantity("3.000", "un")).toBe("3 un");
  });

  it.each(["abc", "1.2345", "", "1,5"])("returns invalid input unchanged: %j", (input) => {
    expect(formatQuantity(input)).toBe(input);
  });
});
