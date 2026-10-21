import { lineTotals, saleTotals } from "@/server/sales/pricing";

export type CartLine = { variantId: string; label: string; sku: string; unit: "un" | "kg" | "l" | "m"; quantity: string; unitPriceCents: number; discountCents: number };
export type Cart = CartLine[];
const THOUSAND = BigInt(1000);

export function quantityMilli(value: string): bigint | null {
  const match = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]) * THOUSAND + BigInt((match[2] ?? "").padEnd(3, "0") || "0");
}

export function addLine(cart: Cart, line: Omit<CartLine, "quantity" | "discountCents">, quantity = "1"): Cart {
  const found = cart.find((item) => item.variantId === line.variantId);
  if (!found) return [...cart, { ...line, quantity, discountCents: 0 }];
  const next = quantityMilli(found.quantity);
  const addition = quantityMilli(quantity);
  if (next === null || addition === null) return cart;
  return cart.map((item) => item.variantId === line.variantId ? { ...item, quantity: `${(next + addition) / THOUSAND}.${String((next + addition) % THOUSAND).padStart(3, "0")}` } : item);
}

export function setQuantity(cart: Cart, variantId: string, quantity: string): Cart {
  const parsed = quantityMilli(quantity);
  if (parsed === null || parsed <= BigInt(0)) return cart;
  return cart.map((line) => line.variantId === variantId ? { ...line, quantity } : line);
}

export function removeLine(cart: Cart, variantId: string): Cart { return cart.filter((line) => line.variantId !== variantId); }

export function cartTotals(cart: Cart, discountCents = 0, surchargeCents = 0) {
  return saleTotals(cart.map((line) => ({ quantityMilli: quantityMilli(line.quantity) ?? BigInt(0), unitPriceCents: line.unitPriceCents, discountCents: line.discountCents })), discountCents, surchargeCents);
}

export function lineTotal(line: CartLine) {
  return lineTotals({ quantityMilli: quantityMilli(line.quantity) ?? BigInt(0), unitPriceCents: line.unitPriceCents, discountCents: line.discountCents }).netCents;
}

export function saveCart(key: string, cart: Cart): void {
  try { globalThis.sessionStorage?.setItem(key, JSON.stringify(cart)); } catch { /* Storage can be disabled or full. */ }
}

export function loadCart(key: string): Cart {
  try {
    const raw = globalThis.sessionStorage?.getItem(key);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((line): line is CartLine => Boolean(line && typeof line.variantId === "string" && typeof line.quantity === "string" && typeof line.unitPriceCents === "number" && typeof line.label === "string" && typeof line.sku === "string" && ["un", "kg", "l", "m"].includes(line.unit) && typeof line.discountCents === "number"));
  } catch { return []; }
}
