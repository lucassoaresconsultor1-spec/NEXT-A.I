import { z } from "zod";

// Pure validation for the operational rules (no database access), shared by
// the settings service and its forms.

export const CUSTOMER_REQUIREMENTS = ["none", "optional", "required"] as const;
export type CustomerRequirement = (typeof CUSTOMER_REQUIREMENTS)[number];

export const CUSTOMER_REQUIREMENT_LABELS: Record<CustomerRequirement, string> = {
  none: "Não pedir cliente",
  optional: "Cliente opcional",
  required: "Cliente obrigatório",
};

/** 100,00 % in basis points. */
export const MAX_DISCOUNT_BPS = 10_000;
export const RECEIPT_TEXT_MAX = 240;
export const RECEIPT_TEXT_MAX_LINES = 4;

const PERCENT_PATTERN = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

/** "10", "10,5", "10.25", "0" -> basis points (1050 = 10,50 %); null when invalid, negative, above 100 or with more than 2 decimals. */
export function parsePercentToBps(value: string): number | null {
  const match = PERCENT_PATTERN.exec(value.trim());
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps > MAX_DISCOUNT_BPS ? null : bps;
}

/** 1050 -> "10,5"; 1000 -> "10"; 1 -> "0,01" (pt-BR, no "%"). */
export function formatBpsInput(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  return `${whole},${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

const PERCENT_MESSAGE = "Informe um percentual entre 0 e 100, com até duas casas decimais.";
const TEXT_MESSAGE = `Use no máximo ${RECEIPT_TEXT_MAX} caracteres e ${RECEIPT_TEXT_MAX_LINES} linhas.`;
const CHOICE_MESSAGE = "Selecione uma opção válida.";
// Line breaks are the only control characters allowed in receipt texts.
const CONTROL_CHARACTERS = /[\u0000-\u0009\u000B-\u001F\u007F]/;

/** Form strings are percentages; numbers are already basis points (service callers). */
const discountBps = z.union([z.string(), z.number()], { error: PERCENT_MESSAGE }).transform((value, context) => {
  const bps = typeof value === "number" ? value : parsePercentToBps(value);
  if (bps === null || !Number.isInteger(bps) || bps < 0 || bps > MAX_DISCOUNT_BPS) {
    context.addIssue({ code: "custom", message: PERCENT_MESSAGE });
    return z.NEVER;
  }
  return bps;
});

/** Trimmed text with normalized line breaks; empty -> null. */
const receiptText = z
  .union([z.string(), z.null(), z.undefined()], { error: TEXT_MESSAGE })
  .transform((value, context) => {
    const text = (value ?? "").replace(/\r\n?/g, "\n").trim();
    if (text === "") return null;
    if (text.length > RECEIPT_TEXT_MAX || text.split("\n").length > RECEIPT_TEXT_MAX_LINES || CONTROL_CHARACTERS.test(text)) {
      context.addIssue({ code: "custom", message: TEXT_MESSAGE });
      return z.NEVER;
    }
    return text;
  });

const requirement = z.enum(CUSTOMER_REQUIREMENTS, { error: CHOICE_MESSAGE });

/** "" (or absent) means "inherit from the organization" on store overrides. */
const inherit = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" || value === undefined ? null : value), schema.nullable());

export const organizationOperationsSchema = z.object({
  customerRequirement: requirement,
  maxDiscountBps: discountBps,
  receiptHeader: receiptText,
  receiptFooter: receiptText,
});
export type OrganizationOperationsInput = z.input<typeof organizationOperationsSchema>;

export const storeOperationsSchema = z.object({
  customerRequirement: inherit(requirement),
  maxDiscountBps: inherit(discountBps),
  receiptHeader: receiptText,
});
export type StoreOperationsInput = z.input<typeof storeOperationsSchema>;
