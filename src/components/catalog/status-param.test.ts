import { describe, expect, it } from "vitest";
import { parseStatusParam, statusToParam } from "./status-param";

describe("status-param", () => {
  it("parses valid status params", () => {
    expect(parseStatusParam("ativo")).toBe("active");
    expect(parseStatusParam("inativo")).toBe("inactive");
  });

  it.each([
    ["empty string", ""],
    ["english active", "active"],
    ["uppercase", "ATIVO"],
    ["undefined", undefined],
    ["null", null],
    ["number", 123],
    ["single element array", ["ativo"]],
    ["multiple elements array", ["ativo", "inativo"]],
    ["boolean", true],
    ["object", {}],
  ])("returns undefined for invalid param: %s", (_, input) => {
    expect(parseStatusParam(input)).toBeUndefined();
  });

  it("converts catalog status to param", () => {
    expect(statusToParam("active")).toBe("ativo");
    expect(statusToParam("inactive")).toBe("inativo");
    expect(statusToParam(undefined)).toBe("");
  });

  it.each(["ativo", "inativo"] as const)("preserves status in roundtrip for %s", (param) => {
    expect(statusToParam(parseStatusParam(param))).toBe(param);
  });
});
