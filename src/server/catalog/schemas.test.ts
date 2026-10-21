import { describe, expect, it } from "vitest";
import { createProductSchema, isValidGtin, newVariantSchema, productFiltersSchema, productInputSchema, supplierInputSchema } from "./schemas";

const CATEGORY_ID = "5f0c6d1e-8a51-4c5e-9f41-2b7a0c3d9e10";

describe("isValidGtin", () => {
  it.each(["7891000315507", "96385074", "036000291452", "17891000315504"])("accepts %s", (code) => {
    expect(isValidGtin(code)).toBe(true);
  });

  it.each(["7891000315508", "1234567", "123456789", "78910003155A7", ""])("rejects %j", (code) => {
    expect(isValidGtin(code)).toBe(false);
  });
});

describe("newVariantSchema", () => {
  it("normalizes SKU, barcode and cents", () => {
    expect(newVariantSchema.parse({ name: " Nº 39 ", sku: " tn-39.pt ", barcode: "789 1000 31550 7", priceCents: "38990", costCents: "" })).toEqual({
      name: "Nº 39",
      sku: "TN-39.PT",
      barcode: "7891000315507",
      priceCents: 38990,
      costCents: undefined,
    });
  });

  it("rejects invalid SKUs, barcodes and amounts", () => {
    const result = newVariantSchema.safeParse({ name: "", sku: "-ABC", barcode: "7891000315508", priceCents: "12,90", costCents: -1 });
    expect(new Set(result.error?.issues.map((issue) => issue.path[0]))).toEqual(new Set(["name", "sku", "barcode", "priceCents", "costCents"]));
  });
});

describe("productInputSchema", () => {
  it("keeps omitted references as undefined and clears empty ones", () => {
    const parsed = productInputSchema.parse({ name: "Tênis Corrida", categoryId: CATEGORY_ID, brandId: "" });
    expect(parsed).toMatchObject({ name: "Tênis Corrida", categoryId: CATEGORY_ID, brandId: null });
    expect(parsed.supplierId).toBeUndefined();
    expect(parsed.unit).toBeUndefined();
  });

  it("rejects unknown units and invalid references", () => {
    const result = productInputSchema.safeParse({ name: "Produto", unit: "cx", supplierId: "x" });
    expect(new Set(result.error?.issues.map((issue) => issue.path[0]))).toEqual(new Set(["unit", "supplierId"]));
  });
});

describe("createProductSchema", () => {
  it("requires at least one variant", () => {
    expect(createProductSchema.safeParse({ name: "Produto", variants: [] }).success).toBe(false);
  });

  it("flags repeated names, SKUs and barcodes among the variants", () => {
    const result = createProductSchema.safeParse({
      name: "Sandália",
      variants: [
        { name: "Nº 36", sku: "SAN-36", barcode: "7891000315507" },
        { name: "nº 36", sku: "san-36", barcode: "7891000315507" },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["variants.1.name", "variants.1.sku", "variants.1.barcode"]);
  });
});

describe("supplierInputSchema", () => {
  it("normalizes document and contacts", () => {
    expect(supplierInputSchema.parse({ name: "Calçados Sul", document: "11.222.333/0001-81", phone: "(51) 3333-4444", email: "" })).toEqual({
      name: "Calçados Sul",
      document: "11222333000181",
      phone: "5133334444",
      email: undefined,
    });
  });
});

describe("productFiltersSchema", () => {
  it("falls back to safe defaults", () => {
    expect(productFiltersSchema.parse({ q: " ", status: "deleted", categoryId: "x", page: "-1" })).toEqual({
      q: undefined,
      status: undefined,
      categoryId: undefined,
      brandId: undefined,
      supplierId: undefined,
      page: 1,
    });
  });
});
