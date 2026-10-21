import { describe, expect, it } from "vitest";
import { customerFiltersSchema, customerInputSchema, maskCpf, maskEmail, maskPhone } from "./schemas";

const base = { name: "Ana Souza", document: "", email: "", phone: "" };

describe("customerInputSchema", () => {
  it("normalizes CPF, e-mail, phone and consent", () => {
    expect(
      customerInputSchema.parse({ ...base, document: "529.982.247-25", email: "Ana.Souza@Exemplo.COM", phone: "(21) 98765-4321", marketingConsent: "on" }),
    ).toEqual({ name: "Ana Souza", document: "52998224725", email: "ana.souza@exemplo.com", phone: "21987654321", marketingConsent: true });
  });

  it("turns empty optional fields into null and missing consent into false", () => {
    expect(customerInputSchema.parse(base)).toEqual({ name: "Ana Souza", document: null, email: null, phone: null, marketingConsent: false });
    expect(customerInputSchema.parse({ ...base, marketingConsent: "false" }).marketingConsent).toBe(false);
  });

  it.each(["111.111.111-11", "123", "529.982.247-24"])("rejects the CPF %j", (document) => {
    const result = customerInputSchema.safeParse({ ...base, document });
    expect(result.success).toBe(false);
  });

  it("rejects short or long names", () => {
    expect(customerInputSchema.safeParse({ ...base, name: "A" }).success).toBe(false);
    expect(customerInputSchema.safeParse({ ...base, name: "x".repeat(121) }).success).toBe(false);
  });
});

describe("customerFiltersSchema", () => {
  it("falls back to safe defaults", () => {
    expect(customerFiltersSchema.parse({ q: "  ", status: "x", page: "abc" })).toEqual({ q: undefined, status: undefined, page: 1 });
  });
});

describe("masks", () => {
  it("masks CPF", () => {
    expect(maskCpf("12345678909")).toBe("***.456.789-**");
    expect(maskCpf("123")).toBe("***");
  });

  it("masks e-mail and phone", () => {
    expect(maskEmail("ana.souza@exemplo.com")).toBe("a***@exemplo.com");
    expect(maskEmail("sem-arroba")).toBe("***");
    expect(maskPhone("21987654321")).toBe("(21) *****-4321");
    expect(maskPhone("2134567890")).toBe("(21) ****-7890");
    expect(maskPhone("12")).toBe("***");
  });
});
