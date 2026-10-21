import { z } from "zod";
import { MAX_CENTS } from "@/server/catalog/schemas";
import { optionalText } from "@/server/forms";

// Pure rules of the sales goals (m11a): input validation, month helpers and the
// progress math in integer cents (percent as a string with one decimal).

export const TARGET_SCOPES = ["organization", "region", "store", "salesperson"] as const;
export type TargetScope = (typeof TARGET_SCOPES)[number];
export const TARGET_SCOPE_LABELS: Record<TargetScope, string> = { organization: "Empresa", region: "Região", store: "Loja", salesperson: "Vendedor" };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthField = z.string({ error: "Informe o mês." }).regex(MONTH, { error: "Informe o mês no formato AAAA-MM." });
const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optionalId = z.preprocess(emptyToUndefined, z.uuid({ error: "Seleção inválida." }).optional());

export const targetInputSchema = z
  .object({
    scope: z.enum(TARGET_SCOPES, { error: "Escolha o escopo da meta." }),
    regionId: optionalId,
    storeId: optionalId,
    salespersonId: optionalId,
    month: monthField,
    amountCents: z.coerce
      .number({ error: "Informe o valor da meta." })
      .int({ error: "Informe o valor em centavos." })
      .min(1, { error: "A meta precisa ser maior que zero." })
      .max(MAX_CENTS, { error: "Valor acima do permitido." }),
    reason: optionalText(240),
  })
  .superRefine((input, context) => {
    const need = (field: "regionId" | "storeId" | "salespersonId", message: string) => {
      if (!input[field]) context.addIssue({ code: "custom", path: [field], message });
    };
    if (input.scope === "region") need("regionId", "Selecione a região.");
    if (input.scope === "store" || input.scope === "salesperson") need("storeId", "Selecione a loja.");
    if (input.scope === "salesperson") need("salespersonId", "Selecione o vendedor.");
    if (input.reason !== undefined && input.reason.length < 3) context.addIssue({ code: "custom", path: ["reason"], message: "Use ao menos 3 caracteres." });
  })
  // Only the fields of the chosen scope are kept.
  .transform((input) => ({
    ...input,
    regionId: input.scope === "region" ? input.regionId! : null,
    storeId: input.scope === "store" || input.scope === "salesperson" ? input.storeId! : null,
    salespersonId: input.scope === "salesperson" ? input.salespersonId! : null,
  }));
export type TargetInput = z.input<typeof targetInputSchema>;
export type ParsedTarget = z.output<typeof targetInputSchema>;

export const targetFiltersSchema = z.object({
  month: monthField,
  scope: z.enum(TARGET_SCOPES).optional().catch(undefined),
  storeId: z.uuid().optional().catch(undefined),
});
export type TargetFilters = z.input<typeof targetFiltersSchema>;

/** "2027-02" -> { from: "2027-02-01", to: "2027-02-28" }. */
export function monthRange(month: string) {
  const [year, value] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Calendar day "YYYY-MM-DD" in a time zone. */
export function todayIn(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

/** Achieved ÷ goal with one decimal, rounded down: 12345 of 20000 -> "61.7". */
export function percentOf(achievedCents: number, targetCents: number) {
  const tenths = Math.floor((achievedCents * 1000) / targetCents);
  const sign = tenths < 0 ? "-" : "";
  const value = Math.abs(tenths);
  return `${sign}${Math.floor(value / 10)}.${value % 10}`;
}

/** Linear projection for the whole month by working days; 0 before the first working day. */
export function projectionOf(achievedCents: number, elapsedDays: number, totalDays: number) {
  if (elapsedDays <= 0) return 0;
  return Math.floor((achievedCents * totalDays) / elapsedDays);
}
