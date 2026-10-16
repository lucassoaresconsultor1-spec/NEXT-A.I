import { describe, expect, it } from "vitest";
import { describeChanges, formatAuditValue, MAX_VALUE_LENGTH } from "./audit-details";

describe("describeChanges", () => {
  it("renders field diffs as 'campo: de → para' with pt-BR labels", () => {
    expect(describeChanges({ name: { from: "Antiga", to: "Nova" }, document: { from: null, to: "11222333000181" } })).toEqual([
      "nome: Antiga → Nova",
      "CNPJ: — → 11222333000181",
    ]);
  });

  it("renders flat values as 'campo: valor' and keeps unknown keys", () => {
    expect(describeChanges({ plan: "essencial", detachedStores: 2, isActive: false, customField: "x" })).toEqual([
      "plano: Essencial",
      "lojas sem região: 2",
      "ativo: não",
      "customField: x",
    ]);
  });

  it("only treats objects with exactly from/to as diffs", () => {
    expect(describeChanges({ scope: { from: "a", to: "b", extra: 1 } })).toEqual(['scope: {"from":"a","to":"b","extra":1}']);
  });

  it("returns no lines for empty or malformed payloads", () => {
    expect(describeChanges(null)).toEqual([]);
    expect(describeChanges(undefined)).toEqual([]);
    expect(describeChanges("texto")).toEqual([]);
    expect(describeChanges(["a"])).toEqual([]);
    expect(describeChanges({})).toEqual([]);
  });
});

describe("formatAuditValue", () => {
  it("truncates long values", () => {
    const text = formatAuditValue("x".repeat(500));
    expect(text).toHaveLength(MAX_VALUE_LENGTH);
    expect(text.endsWith("…")).toBe(true);
  });

  it("joins arrays and stringifies nested objects safely", () => {
    expect(formatAuditValue(["stores.read", "stores.manage"])).toBe("stores.read, stores.manage");
    expect(formatAuditValue([])).toBe("—");
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
  });

  it("does not throw on values JSON cannot serialize", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatAuditValue(circular)).toBe("…");
  });
});
