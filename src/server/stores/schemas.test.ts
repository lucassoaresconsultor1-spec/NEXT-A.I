import { describe, expect, it } from "vitest";
import { isUuid, storeFiltersSchema, storeInputSchema } from "./schemas";

const REGION_ID = "5f0c6d1e-8a51-4c5e-9f41-2b7a0c3d9e10";

describe("storeInputSchema", () => {
  it("normalizes code, documents and empty optional fields", () => {
    const parsed = storeInputSchema.parse({
      code: "  sp-01 ",
      name: "  Loja Centro ",
      document: "11.222.333/0001-81",
      phone: "(11) 98765-4321",
      email: " Loja@Exemplo.COM ",
      postalCode: "01310-100",
      street: "",
      number: " 1000 ",
      state: "sp",
      timezone: "",
      regionId: "",
    });
    expect(parsed).toMatchObject({
      code: "SP-01",
      name: "Loja Centro",
      document: "11222333000181",
      phone: "11987654321",
      email: "loja@exemplo.com",
      postalCode: "01310100",
      number: "1000",
      state: "SP",
      regionId: null,
    });
    expect(parsed.street).toBeUndefined();
    expect(parsed.timezone).toBeUndefined();
  });

  it("accepts the alphanumeric CNPJ format", () => {
    const parsed = storeInputSchema.parse({ code: "A1", name: "Loja", document: "12.ABC.345/01DE-35" });
    expect(parsed.document).toBe("12ABC34501DE35");
  });

  it("keeps a missing region as undefined, so updates keep the current one", () => {
    expect(storeInputSchema.parse({ code: "A1", name: "Loja" }).regionId).toBeUndefined();
    expect(storeInputSchema.parse({ code: "A1", name: "Loja", regionId: REGION_ID }).regionId).toBe(REGION_ID);
  });

  it.each([
    ["", "Informe o código da loja."],
    ["LOJA CENTRO", "Use apenas letras sem acento, números e hífen."],
    ["SÃO-01", "Use apenas letras sem acento, números e hífen."],
    ["A".repeat(17), "Use no máximo 16 caracteres."],
  ])("rejects the code %j", (code, message) => {
    const result = storeInputSchema.safeParse({ code, name: "Loja" });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((entry) => entry.path[0] === "code");
    expect(issue?.message).toBe(message);
  });

  it("reports each invalid field by its form name", () => {
    const result = storeInputSchema.safeParse({
      code: "OK-1",
      name: "L",
      document: "11.222.333/0001-82",
      phone: "1234",
      email: "sem-arroba",
      postalCode: "123",
      state: "XX",
      timezone: "Europe/Lisbon",
      regionId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
    const fields = new Set(result.error?.issues.map((issue) => issue.path[0]));
    expect([...fields].sort()).toEqual(
      ["document", "email", "name", "phone", "postalCode", "regionId", "state", "timezone"].sort(),
    );
  });

  it("enforces the column lengths of the address fields", () => {
    const result = storeInputSchema.safeParse({ code: "A1", name: "Loja", number: "1".repeat(17), city: "c".repeat(81) });
    expect(result.error?.issues.map((issue) => issue.path[0]).sort()).toEqual(["city", "number"]);
  });
});

describe("storeFiltersSchema", () => {
  it("falls back to safe defaults for unknown values", () => {
    expect(storeFiltersSchema.parse({ q: "  ", status: "deleted", regionId: "x", sort: "password", dir: "up", page: "-3" })).toEqual({
      q: undefined,
      status: undefined,
      regionId: undefined,
      sort: "name",
      dir: "asc",
      page: 1,
    });
  });

  it("keeps whitelisted values", () => {
    expect(storeFiltersSchema.parse({ q: " centro ", status: "inactive", regionId: "none", sort: "region", dir: "desc", page: "2" })).toEqual({
      q: "centro",
      status: "inactive",
      regionId: "none",
      sort: "region",
      dir: "desc",
      page: 2,
    });
    expect(storeFiltersSchema.parse({ regionId: REGION_ID }).regionId).toBe(REGION_ID);
  });
});

describe("isUuid", () => {
  it("recognizes only UUIDs", () => {
    expect(isUuid(REGION_ID)).toBe(true);
    expect(isUuid("nova")).toBe(false);
  });
});
