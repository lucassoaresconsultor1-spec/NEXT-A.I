import { z } from "zod";
import { onlyDigits } from "@/lib/documents";
import { optionalCnpj, optionalEmail, optionalPhone, optionalText, requiredText } from "@/server/forms";
import { parsePage } from "@/server/pagination";

// Pure validation for the catalog: shared by future Server Actions (early
// field errors) and by the services (defense in depth for any other caller).
// Money is always integer cents.

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const PRODUCT_UNITS = ["un", "kg", "l", "m"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** R$ 999.999.999,99: far above any retail price, well inside Number.MAX_SAFE_INTEGER. */
export const MAX_CENTS = 99_999_999_999;
export const MAX_VARIANTS_PER_PRODUCT = 50;

export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/** GTIN-8/12/13/14 (EAN-8, UPC-A, EAN-13, DUN-14) with a valid check digit. */
export function isValidGtin(value: string) {
  if (!/^\d+$/.test(value) || !GTIN_LENGTHS.has(value.length)) return false;
  const digits = [...value].map(Number);
  const check = digits.pop()!;
  // Weights 3,1,3,1… from the digit next to the check digit.
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const skuField = z
  .string({ error: "Informe o SKU." })
  .trim()
  .toUpperCase()
  .min(1, { error: "Informe o SKU." })
  .max(40, { error: "Use no máximo 40 caracteres." })
  .regex(SKU_PATTERN, { error: "Use letras sem acento, números, ponto, hífen ou sublinhado, começando por letra ou número." });

const barcodeField = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .transform(onlyDigits)
    .refine(isValidGtin, { error: "Código de barras inválido. Use um GTIN/EAN de 8, 12, 13 ou 14 dígitos." })
    .optional(),
);

/** Integer cents; accepts numeric strings from forms. Empty means "not informed". */
export const centsField = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number({ error: "Informe um valor em centavos." })
    .int({ error: "Informe um valor inteiro em centavos." })
    .min(0, { error: "O valor não pode ser negativo." })
    .max(MAX_CENTS, { error: "Valor acima do permitido." }),
);
const optionalCents = z.preprocess(emptyToUndefined, centsField.optional());

/** `undefined` = not sent (keep on update), empty or `null` = none, otherwise an id. */
const optionalReference = z.preprocess(
  (value) => (value === "" ? null : value),
  z.uuid({ error: "Seleção inválida." }).nullable().optional(),
);

// ---- Categories, brands and suppliers ----

export const referenceInputSchema = z.object({ name: requiredText("o nome", 80, 2) });
export type ReferenceInput = z.infer<typeof referenceInputSchema>;

export const supplierInputSchema = z.object({
  name: requiredText("o nome do fornecedor", 120, 2),
  document: optionalCnpj,
  email: optionalEmail,
  phone: optionalPhone,
});
export type SupplierInput = z.infer<typeof supplierInputSchema>;

// ---- Products and variants ----

export const productInputSchema = z.object({
  name: requiredText("o nome do produto", 120, 2),
  description: optionalText(1000),
  unit: z.enum(PRODUCT_UNITS, { error: "Selecione uma unidade válida." }).optional(),
  categoryId: optionalReference,
  brandId: optionalReference,
  supplierId: optionalReference,
});
export type ProductInput = z.input<typeof productInputSchema>;
export type ParsedProductInput = z.output<typeof productInputSchema>;

export const variantInputSchema = z.object({
  name: requiredText("o nome da variação", 80),
  sku: skuField,
  barcode: barcodeField,
});
export type VariantInput = z.input<typeof variantInputSchema>;

export const newVariantSchema = variantInputSchema.extend({ priceCents: optionalCents, costCents: optionalCents });
export type NewVariantInput = z.input<typeof newVariantSchema>;

function duplicatedIndexes(values: (string | undefined)[]) {
  const seen = new Map<string, number>();
  const repeated: number[] = [];
  values.forEach((value, index) => {
    if (value === undefined) return;
    if (seen.has(value)) repeated.push(index);
    else seen.set(value, index);
  });
  return repeated;
}

export const createProductSchema = productInputSchema
  .extend({
    variants: z
      .array(newVariantSchema, { error: "Informe as variações." })
      .min(1, { error: "Cadastre ao menos uma variação." })
      .max(MAX_VARIANTS_PER_PRODUCT, { error: `Use no máximo ${MAX_VARIANTS_PER_PRODUCT} variações por produto.` }),
  })
  .superRefine((input, context) => {
    const checks = [
      { key: "name", values: input.variants.map((variant) => variant.name.toLowerCase()), message: "Nome de variação repetido." },
      { key: "sku", values: input.variants.map((variant) => variant.sku), message: "SKU repetido entre as variações." },
      { key: "barcode", values: input.variants.map((variant) => variant.barcode), message: "Código de barras repetido entre as variações." },
    ];
    for (const { key, values, message } of checks) {
      for (const index of duplicatedIndexes(values)) context.addIssue({ code: "custom", path: ["variants", index, key], message });
    }
  });
export type CreateProductInput = z.input<typeof createProductSchema>;

export const priceInputSchema = z.object({ cents: centsField });

// ---- Filters (URL values fall back to safe defaults) ----

export const CATALOG_STATUSES = ["active", "inactive"] as const;
const statusFilter = z.enum(CATALOG_STATUSES).optional().catch(undefined);
const searchFilter = z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()).catch(undefined);
const idFilter = z.uuid().optional().catch(undefined);

export const productFiltersSchema = z.object({
  q: searchFilter,
  status: statusFilter,
  categoryId: idFilter,
  brandId: idFilter,
  supplierId: idFilter,
  page: z.unknown().optional().transform(parsePage),
});
export type ProductFilters = z.output<typeof productFiltersSchema>;

export const referenceFiltersSchema = z.object({ status: statusFilter });
export type ReferenceFilters = z.output<typeof referenceFiltersSchema>;

export const supplierFiltersSchema = z.object({ q: searchFilter, status: statusFilter, page: z.unknown().optional().transform(parsePage) });
export type SupplierFilters = z.output<typeof supplierFiltersSchema>;
