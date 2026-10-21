import { describe, expect, it } from "vitest";
import { addLine, cartTotals, loadCart, removeLine, saveCart, setQuantity, type Cart } from "./cart";

const line = { variantId: "a", label: "Produto", sku: "SKU", unit: "un" as const, unitPriceCents: 1290 };

describe("PDV cart", () => {
  it("soma itens repetidos e remove", () => {
    const cart = addLine(addLine([], line), line, "2");
    expect(cart[0].quantity).toBe("3.000");
    expect(removeLine(cart, "a")).toEqual([]);
  });
  it("aceita quantidade fracionada em kg e usa arredondamento do serviço", () => {
    const cart = addLine([], { ...line, unit: "kg", unitPriceCents: 4990 }, "0,355");
    expect(cartTotals(cart).totalCents).toBe(1771);
    expect(setQuantity(cart, "a", "0,5")[0].quantity).toBe("0,5");
  });
  it("calcula totais como pricing.ts", () => {
    const carts: Cart[] = [
      addLine([], line, "3"),
      addLine([], { ...line, unit: "kg", unitPriceCents: 4990 }, "0,355"),
      [{ ...line, quantity: "2", discountCents: 100 }],
    ];
    expect(carts.map((cart) => cartTotals(cart).totalCents)).toEqual([3870, 1771, 2480]);
  });
  it("tolera indisponibilidade de sessionStorage", () => {
    const storage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => { throw new Error("disabled"); } });
    expect(() => saveCart("x", [])).not.toThrow();
    expect(loadCart("x")).toEqual([]);
    if (storage) Object.defineProperty(globalThis, "sessionStorage", storage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });
});
