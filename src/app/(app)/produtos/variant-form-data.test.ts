import { describe, expect, it } from "vitest";
import { createProductSchema } from "@/server/catalog/schemas";
import { formFieldErrors, readVariantRows } from "./variant-form-data";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("readVariantRows", () => {
  it("reads valid rows in index order with cents", () => {
    const result = readVariantRows(
      form({
        "variants.0.name": "39",
        "variants.0.sku": "TEN-39",
        "variants.0.barcode": "",
        "variants.0.price": "389,90",
        "variants.0.cost": "195",
        "variants.1.name": "41",
        "variants.1.sku": "TEN-41",
      }),
      { withCost: true },
    );
    expect(result.fieldErrors).toEqual({});
    expect(result.rows).toEqual([
      { name: "39", sku: "TEN-39", barcode: "", priceCents: 38990, costCents: 19500 },
      { name: "41", sku: "TEN-41", barcode: "" },
    ]);
    expect(result.formIndexes).toEqual([0, 1]);
  });

  it("skips fully empty rows and ignores indexes from 50 on", () => {
    const result = readVariantRows(
      form({
        "variants.0.name": "Único",
        "variants.0.sku": "A-1",
        "variants.1.name": " ",
        "variants.2.name": "Azul",
        "variants.2.sku": "A-2",
        "variants.50.name": "Fora",
        "variants.50.sku": "A-50",
      }),
      { withCost: false },
    );
    expect(result.rows.map((row) => row.sku)).toEqual(["A-1", "A-2"]);
    expect(result.formIndexes).toEqual([0, 2]);
  });

  it("reports invalid money on the field of the form row", () => {
    const result = readVariantRows(form({ "variants.0.name": "U", "variants.0.sku": "U-1", "variants.0.price": "abc" }), { withCost: false });
    expect(result.fieldErrors["variants.0.price"]).toEqual(["Informe um valor em reais, como 12,90."]);
    expect(result.rows[0].priceCents).toBeUndefined();
  });

  it("ignores the cost when the member cannot manage costs", () => {
    const result = readVariantRows(form({ "variants.0.name": "U", "variants.0.sku": "U-1", "variants.0.cost": "10,00" }), { withCost: false });
    expect(result.rows).toEqual([{ name: "U", sku: "U-1", barcode: "" }]);
    expect(result.fieldErrors).toEqual({});
  });
});

describe("formFieldErrors", () => {
  it("maps variant issues to the form row index and keeps product fields", () => {
    const parsed = createProductSchema.safeParse({
      name: "",
      variants: [
        { name: "A", sku: "DUP-1" },
        { name: "B", sku: "DUP-1" },
      ],
    });
    expect(parsed.success).toBe(false);
    const errors = parsed.success ? {} : formFieldErrors(parsed.error, [0, 3]);
    expect(errors.name).toEqual(expect.any(Array));
    expect(errors["variants.3.sku"]).toEqual(["SKU repetido entre as variações."]);
  });

  it("keeps the list-level error under variants", () => {
    const parsed = createProductSchema.safeParse({ name: "Produto", variants: [] });
    expect(parsed.success ? {} : formFieldErrors(parsed.error)).toHaveProperty("variants");
  });
});
