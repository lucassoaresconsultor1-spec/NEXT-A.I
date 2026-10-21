import type { z } from "zod";
import { parseBrlToCents } from "@/lib/money";
import { MAX_ORDER_ITEMS } from "@/server/purchasing/schemas";

// Reads the indexed item fields of the purchase order and receipt forms
// (items.{i}.…) without the service. Rows the member left out are skipped, so
// each result keeps `formIndexes` to put errors back on the row they belong to.

export interface OrderItemRow {
  variantId: string;
  quantity: string;
  unitCostCents: number;
}

export interface ReceiptItemRow {
  orderItemId: string;
  quantity: string;
}

const MONEY_MESSAGE = "Informe um valor em reais, como 12,90.";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Order items in index order; rows without variantId are ignored; unit cost typed in reais becomes cents. */
export function readOrderItems(formData: FormData): { items: OrderItemRow[]; fieldErrors: Record<string, string[]>; formIndexes: number[] } {
  const items: OrderItemRow[] = [];
  const formIndexes: number[] = [];
  const fieldErrors: Record<string, string[]> = {};
  for (let index = 0; index < MAX_ORDER_ITEMS; index += 1) {
    const prefix = `items.${index}.`;
    const variantId = text(formData, `${prefix}variantId`);
    if (!variantId) continue;
    const unitCostCents = parseBrlToCents(text(formData, `${prefix}unitCost`));
    if (unitCostCents === null) fieldErrors[`${prefix}unitCostCents`] = [MONEY_MESSAGE];
    items.push({ variantId, quantity: text(formData, `${prefix}quantity`), unitCostCents: unitCostCents ?? 0 });
    formIndexes.push(index);
  }
  return { items, fieldErrors, formIndexes };
}

/** Receipt lines with a typed quantity, in index order; empty quantities are ignored. */
export function readReceiptItems(formData: FormData): { items: ReceiptItemRow[]; formIndexes: number[] } {
  const items: ReceiptItemRow[] = [];
  const formIndexes: number[] = [];
  for (let index = 0; index < MAX_ORDER_ITEMS; index += 1) {
    const orderItemId = text(formData, `items.${index}.orderItemId`);
    const quantity = text(formData, `items.${index}.quantity`);
    if (!orderItemId || !quantity) continue;
    items.push({ orderItemId, quantity });
    formIndexes.push(index);
  }
  return { items, formIndexes };
}

/** "items.{n}.field" -> "items.{formIndexes[n]}.field"; other keys unchanged. */
export function toFormKey(key: string, formIndexes: readonly number[]): string {
  const match = /^items\.(\d+)\.(.+)$/.exec(key);
  if (!match) return key;
  const position = Number(match[1]);
  return `items.${formIndexes[position] ?? position}.${match[2]}`;
}

/** Field errors from the service (already keyed items.{n}.field) moved to the form rows. */
export function remapFieldErrors(fieldErrors: Record<string, string[]> | undefined, formIndexes: readonly number[]) {
  if (!fieldErrors) return undefined;
  return Object.fromEntries(Object.entries(fieldErrors).map(([key, messages]) => [toFormKey(key, formIndexes), messages]));
}

/** Zod issues keyed like the form (nested item paths keep their row index). */
export function formFieldErrors(error: z.ZodError, formIndexes: readonly number[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const [first, index, field] = issue.path;
    const key =
      first === "items" && typeof index === "number" && typeof field === "string"
        ? `items.${formIndexes[index] ?? index}.${field}`
        : String(first ?? "form");
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}
