import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { autoMapping, createImportSchema, normalizeHeader } from "./schemas";

describe("import schemas", () => {
  it("maps headers without accents, case or separators, using each column once", () => {
    expect(normalizeHeader("  Preço_de-Venda ")).toBe("preco de venda");
    expect(autoMapping("products", ["Produto", "SKU", "Preço", "Código de barras", "Nome"])).toEqual({
      productName: "Produto",
      sku: "SKU",
      price: "Preço",
      barcode: "Código de barras",
    });
    expect(autoMapping("customers", ["Nome completo", "CPF", "E-mail", "Celular"])).toEqual({ name: "Nome completo", document: "CPF", email: "E-mail", phone: "Celular" });
  });

  it("requires the mandatory fields, the store for opening stock and distinct columns", () => {
    expect(createImportSchema.safeParse({ kind: "products", fileName: "a.csv", mapping: { productName: "Nome" } }).success).toBe(false);
    expect(createImportSchema.safeParse({ kind: "opening_stock", fileName: "a.csv", mapping: { sku: "SKU", quantity: "Qtd" } }).success).toBe(false);
    expect(createImportSchema.safeParse({ kind: "customers", fileName: "a.csv", mapping: { name: "Nome", email: "Nome" } }).success).toBe(false);
    expect(createImportSchema.safeParse({ kind: "customers", fileName: "a.csv", mapping: { name: "Nome", other: "X" } }).success).toBe(false);
    const parsed = createImportSchema.parse({ kind: "customers", storeId: randomUUID(), fileName: "clientes.csv", mapping: { name: "Nome", email: "" } });
    expect(parsed).toMatchObject({ storeId: undefined, mapping: { name: "Nome" } });
  });
});
