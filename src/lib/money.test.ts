import { describe, expect, it } from "vitest";
import { formatCentsInput, parseBrlToCents } from "./money";

describe("parseBrlToCents", () => {
  it.each([
    ["12,90", 1290],
    ["12.90", 1290],
    ["12.9", 1290],
    ["1.234,56", 123456],
    ["R$ 1.234,56", 123456],
    ["0", 0],
    ["0,5", 50],
    [" 7 ", 700],
    ["999.999.999,99", 99999999999],
  ])("parses %j", (input, expected) => {
    expect(parseBrlToCents(input)).toBe(expected);
  });

  it.each(["", "-1", "abc", "1,234", "1.23.4", "12,999", "1.000.000.000,00", "1e3"])("rejects %j", (input) => {
    expect(parseBrlToCents(input)).toBeNull();
  });
});

describe("formatCentsInput", () => {
  it.each([
    [1290, "12,90"],
    [123456, "1.234,56"],
    [0, "0,00"],
    [5, "0,05"],
  ])("formats %d", (cents, expected) => {
    expect(formatCentsInput(cents)).toBe(expected);
  });

  it("round-trips with parseBrlToCents", () => {
    for (const cents of [0, 5, 1290, 123456, 99999999999]) expect(parseBrlToCents(formatCentsInput(cents))).toBe(cents);
  });
});
