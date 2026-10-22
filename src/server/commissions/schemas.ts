import { z } from "zod";
import { isValidCalendarDay, type CalendarDay } from "@/lib/business-days";
import { optionalText, requiredText } from "@/server/forms";
import { parsePage } from "@/server/pagination";

// Pure rules of the commissions (m12a): validation, the rate in force for a sale
// item and the commission of a base in integer cents (rates in basis points).

export const STATEMENT_STATUSES = ["calculated", "approved", "paid", "cancelled"] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];
export const STATEMENT_STATUS_LABELS: Record<StatementStatus, string> = { calculated: "Apurada", approved: "Aprovada", paid: "Paga", cancelled: "Cancelada" };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthField = z.string({ error: "Informe o mês." }).regex(MONTH, { error: "Informe o mês no formato AAAA-MM." });
const rate = z.coerce.number({ error: "Informe a taxa." }).int({ error: "Use a taxa em pontos-base (1% = 100)." }).min(0).max(10_000, { error: "A taxa vai até 100%." });

export const ruleInputSchema = z
  .object({
    storeId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid({ error: "Loja inválida." }).optional()),
    effectiveFrom: z.string({ error: "Informe o início da vigência." }).refine(isValidCalendarDay, { error: "Informe uma data válida." }),
    defaultRateBps: rate,
    categoryRates: z.array(z.object({ categoryId: z.uuid({ error: "Categoria inválida." }), rateBps: rate })).max(500).default([]),
    reason: optionalText(240),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.categoryRates.forEach((entry, index) => {
      if (seen.has(entry.categoryId)) context.addIssue({ code: "custom", path: ["categoryRates", index, "categoryId"], message: "Categoria repetida." });
      seen.add(entry.categoryId);
    });
  });
export type RuleInput = z.input<typeof ruleInputSchema>;

export const statementKeySchema = z.object({
  salespersonId: z.uuid({ error: "Vendedor inválido." }),
  storeId: z.uuid({ error: "Loja inválida." }),
  month: monthField,
});
export type StatementKey = z.output<typeof statementKeySchema>;

export const paySchema = z.object({ paymentReference: requiredText("a referência do pagamento", 60, 3) });
export const cancelSchema = z.object({ reason: requiredText("o motivo", 240, 3) });

export const statementFiltersSchema = z.object({
  month: monthField,
  storeId: z.uuid().optional().catch(undefined),
  status: z.enum(STATEMENT_STATUSES).optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type StatementFilters = z.input<typeof statementFiltersSchema>;

export interface RuleVersion {
  id: string;
  storeId: string | null;
  version: number;
  effectiveFrom: CalendarDay;
  defaultRateBps: number;
  rates: Map<string, number>;
}

/** Rule in force on a day: the store's if any started, else the organization's; latest start wins, then the highest version. */
export function ruleInForce(rules: RuleVersion[], storeId: string, day: CalendarDay): RuleVersion | null {
  const pick = (candidates: RuleVersion[]) =>
    candidates
      .filter((rule) => rule.effectiveFrom <= day)
      .sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? b.version - a.version : a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null;
  return pick(rules.filter((rule) => rule.storeId === storeId)) ?? pick(rules.filter((rule) => rule.storeId === null));
}

export function rateFor(rule: RuleVersion | null, categoryId: string | null) {
  if (!rule) return { ruleId: null, rateBps: 0 };
  return { ruleId: rule.id, rateBps: (categoryId ? rule.rates.get(categoryId) : undefined) ?? rule.defaultRateBps };
}

/** floor(base × rate ÷ 10000), toward minus infinity for reversals so a full reversal cancels the sale exactly. */
export function commissionOf(baseCents: number, rateBps: number) {
  const value = Math.floor((Math.abs(baseCents) * rateBps) / 10_000);
  return baseCents < 0 ? -value : value;
}
