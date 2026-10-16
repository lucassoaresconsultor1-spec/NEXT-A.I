import { describe, expect, it } from "vitest";
import {
  formatCep,
  formatCnpj,
  formatCpf,
  formatPhone,
  isValidCep,
  isValidCnpj,
  isValidCpf,
  isValidPhone,
  normalizeCnpj,
} from "./documents";

describe("CNPJ", () => {
  it("accepts valid numeric CNPJs with or without punctuation", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });

  it("accepts the alphanumeric format (example published by the Receita Federal)", () => {
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidCnpj("12abc34501de35")).toBe(true);
    expect(normalizeCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });

  it("rejects wrong check digits, repeated digits, letters in check digits and bad lengths", () => {
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("12.ABC.345/01DE-36")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("12ABC34501DEA5")).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
  });

  it("formats normalized values", () => {
    expect(formatCnpj("12abc34501de35")).toBe("12.ABC.345/01DE-35");
    expect(formatCnpj("123")).toBe("123");
  });
});

describe("CPF, phone and CEP", () => {
  it("validates CPF check digits", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
  });

  it("validates Brazilian landlines and mobiles with area code", () => {
    expect(isValidPhone("(11) 98765-4321")).toBe(true);
    expect(isValidPhone("1132654321")).toBe(true);
    expect(isValidPhone("(11) 8765-432")).toBe(false);
    expect(isValidPhone("(01) 98765-4321")).toBe(false);
    expect(formatPhone("11987654321")).toBe("(11) 98765-4321");
    expect(formatPhone("1132654321")).toBe("(11) 3265-4321");
  });

  it("validates and formats CEP", () => {
    expect(isValidCep("28970-000")).toBe(true);
    expect(isValidCep("2897000")).toBe(false);
    expect(formatCep("28970000")).toBe("28970-000");
  });
});
