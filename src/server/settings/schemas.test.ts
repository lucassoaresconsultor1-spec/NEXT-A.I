import { describe, expect, it } from "vitest";
import { formatBpsInput, organizationOperationsSchema, parsePercentToBps, storeOperationsSchema } from "./schemas";

const valid = { customerRequirement: "optional", maxDiscountBps: "10,5", receiptHeader: "Loja Centro\nObrigado!", receiptFooter: "" };

describe("parsePercentToBps", () => {
  it.each([
    ["0", 0],
    ["10", 1000],
    ["10,5", 1050],
    ["10.25", 1025],
    ["100", 10000],
    [" 7 ", 700],
  ])("parses %j", (input, expected) => {
    expect(parsePercentToBps(input)).toBe(expected);
  });

  it.each(["-1", "100,01", "10,555", "1e2", "abc", "", "10,"])("rejects %j", (input) => {
    expect(parsePercentToBps(input)).toBeNull();
  });
});

describe("formatBpsInput", () => {
  it.each([
    [0, "0"],
    [1000, "10"],
    [1050, "10,5"],
    [1025, "10,25"],
    [1, "0,01"],
    [10000, "100"],
  ])("formats %d", (bps, expected) => {
    expect(formatBpsInput(bps)).toBe(expected);
  });

  it("round-trips with parsePercentToBps", () => {
    for (const bps of [0, 1, 10, 99, 1050, 1025, 9999, 10000]) expect(parsePercentToBps(formatBpsInput(bps))).toBe(bps);
  });
});

describe("organizationOperationsSchema", () => {
  it("accepts a valid form and normalizes texts", () => {
    const parsed = organizationOperationsSchema.parse(valid);
    expect(parsed).toEqual({ customerRequirement: "optional", maxDiscountBps: 1050, receiptHeader: "Loja Centro\nObrigado!", receiptFooter: null });
  });

  it("accepts basis points from service callers", () => {
    expect(organizationOperationsSchema.parse({ ...valid, maxDiscountBps: 250 }).maxDiscountBps).toBe(250);
    expect(organizationOperationsSchema.safeParse({ ...valid, maxDiscountBps: 10001 }).success).toBe(false);
    expect(organizationOperationsSchema.safeParse({ ...valid, maxDiscountBps: 2.5 }).success).toBe(false);
  });

  it.each([
    ["five lines", "1\n2\n3\n4\n5"],
    ["241 characters", "x".repeat(241)],
    ["a control character", "Loja\u0007"],
  ])("rejects a receipt text with %s", (_label, text) => {
    const result = organizationOperationsSchema.safeParse({ ...valid, receiptHeader: text });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown customer requirement and an empty discount", () => {
    expect(organizationOperationsSchema.safeParse({ ...valid, customerRequirement: "always" }).success).toBe(false);
    expect(organizationOperationsSchema.safeParse({ ...valid, maxDiscountBps: "" }).success).toBe(false);
  });
});

describe("storeOperationsSchema", () => {
  it("turns empty fields into null (inherit)", () => {
    expect(storeOperationsSchema.parse({ customerRequirement: "", maxDiscountBps: "", receiptHeader: "" })).toEqual({
      customerRequirement: null,
      maxDiscountBps: null,
      receiptHeader: null,
    });
  });

  it("keeps informed overrides", () => {
    expect(storeOperationsSchema.parse({ customerRequirement: "required", maxDiscountBps: "5", receiptHeader: " Filial " })).toEqual({
      customerRequirement: "required",
      maxDiscountBps: 500,
      receiptHeader: "Filial",
    });
  });
});
