import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("keeps same-origin paths with their query", () => {
    expect(safeNextPath("/lojas?status=active")).toBe("/lojas?status=active");
    expect(safeNextPath("/equipe/123")).toBe("/equipe/123");
  });

  it("refuses absolute, protocol-relative and browser-normalized external targets", () => {
    for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "painel"]) {
      expect(safeNextPath(value)).toBeNull();
    }
    expect(safeNextPath(undefined)).toBeNull();
    // Percent-encoded control characters stay a same-origin path.
    expect(safeNextPath("/%09/evil.example")).toBe("/%09/evil.example");
  });
});
