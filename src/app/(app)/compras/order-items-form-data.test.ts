import { describe, expect, it } from "vitest";
import { purchaseOrderInputSchema } from "@/server/purchasing/schemas";
import { formFieldErrors, readOrderItems, readReceiptItems, remapFieldErrors } from "./order-items-form-data";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("readOrderItems", () => {
  it("reads items in index order with cents and skips rows without variantId", () => {
    const result = readOrderItems(
      form({
        "items.0.variantId": A,
        "items.0.quantity": "2,5",
        "items.0.unitCost": "12,90",
        "items.1.quantity": "3",
        "items.2.variantId": B,
        "items.2.quantity": "1",
        "items.2.unitCost": "1.234,56",
      }),
    );
    expect(result.items).toEqual([
      { variantId: A, quantity: "2,5", unitCostCents: 1290 },
      { variantId: B, quantity: "1", unitCostCents: 123456 },
    ]);
    expect(result.formIndexes).toEqual([0, 2]);
    expect(result.fieldErrors).toEqual({});
  });

  it("reports an invalid cost on the row and ignores indexes above 199", () => {
    const result = readOrderItems(form({ "items.3.variantId": A, "items.3.quantity": "1", "items.3.unitCost": "abc", "items.200.variantId": B }));
    expect(result.fieldErrors).toEqual({ "items.3.unitCostCents": ["Informe um valor em reais, como 12,90."] });
    expect(result.items).toHaveLength(1);
  });
});

describe("readReceiptItems", () => {
  it("keeps only lines with a quantity", () => {
    const result = readReceiptItems(form({ "items.0.orderItemId": A, "items.0.quantity": "", "items.1.orderItemId": B, "items.1.quantity": "4" }));
    expect(result).toEqual({ items: [{ orderItemId: B, quantity: "4" }], formIndexes: [1] });
  });
});

describe("error keys", () => {
  it("moves service errors and schema issues to the form row", () => {
    expect(remapFieldErrors({ "items.0.quantity": ["acima"], supplierId: ["inativo"] }, [4])).toEqual({
      "items.4.quantity": ["acima"],
      supplierId: ["inativo"],
    });
    const order = (second: { quantity: string }) =>
      purchaseOrderInputSchema.safeParse({
        storeId: A,
        supplierId: B,
        items: [
          { variantId: A, quantity: "1", unitCostCents: 1 },
          { variantId: A, quantity: second.quantity, unitCostCents: 1 },
        ],
      });
    const repeated = order({ quantity: "1" });
    expect(repeated.success ? {} : formFieldErrors(repeated.error, [0, 5])).toEqual({ "items.5.variantId": ["Produto repetido no pedido."] });
    const zero = order({ quantity: "0" });
    expect(zero.success ? {} : formFieldErrors(zero.error, [0, 5])).toHaveProperty(["items.5.quantity"]);
  });
});
