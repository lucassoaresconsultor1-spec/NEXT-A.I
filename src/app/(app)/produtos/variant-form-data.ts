import type { z } from "zod";
import { parseBrlToCents } from "@/lib/money";
import { MAX_VARIANTS_PER_PRODUCT, type ProductUnit } from "@/server/catalog/schemas";

// Reads the indexed variant fields of the product form (variants.{i}.name…)
// without the service: money typed in reais becomes cents here.

export interface VariantFormRow {
  name: string;
  sku: string;
  barcode: string;
  priceCents?: number;
  costCents?: number;
}

export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  un: "Unidade (un)",
  kg: "Quilograma (kg)",
  l: "Litro (l)",
  m: "Metro (m)",
};

const MONEY_MESSAGE = "Informe um valor em reais, como 12,90.";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reads indexes 0..MAX_VARIANTS_PER_PRODUCT-1 in order, skipping fully empty rows.
 * `formIndexes[n]` is the form index of `rows[n]`, so errors the service reports
 * as variants.{n}.field can be shown on the right row.
 */
export function readVariantRows(
  formData: FormData,
  options: { withCost: boolean },
): { rows: VariantFormRow[]; fieldErrors: Record<string, string[]>; formIndexes: number[] } {
  const rows: VariantFormRow[] = [];
  const formIndexes: number[] = [];
  const fieldErrors: Record<string, string[]> = {};
  for (let index = 0; index < MAX_VARIANTS_PER_PRODUCT; index += 1) {
    const prefix = `variants.${index}.`;
    const name = text(formData, `${prefix}name`);
    const sku = text(formData, `${prefix}sku`);
    const barcode = text(formData, `${prefix}barcode`);
    const price = text(formData, `${prefix}price`);
    const cost = options.withCost ? text(formData, `${prefix}cost`) : "";
    if (!name && !sku && !barcode && !price && !cost) continue;

    const row: VariantFormRow = { name, sku, barcode };
    if (price) {
      const cents = parseBrlToCents(price);
      if (cents === null) fieldErrors[`${prefix}price`] = [MONEY_MESSAGE];
      else row.priceCents = cents;
    }
    if (cost) {
      const cents = parseBrlToCents(cost);
      if (cents === null) fieldErrors[`${prefix}cost`] = [MONEY_MESSAGE];
      else row.costCents = cents;
    }
    rows.push(row);
    formIndexes.push(index);
  }
  return { rows, fieldErrors, formIndexes };
}

/**
 * Field errors of a createProductSchema/newVariantSchema failure keyed like the
 * form: variants.{n}.field becomes variants.{formIndexes[n]}.field, so each
 * message lands on the row the member typed; other paths keep their first key.
 */
export function formFieldErrors(error: z.ZodError, formIndexes: readonly number[] = []): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const [first, index, field] = issue.path;
    const key =
      first === "variants" && typeof index === "number" && typeof field === "string"
        ? `variants.${formIndexes[index] ?? index}.${field}`
        : String(first ?? "form");
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}
