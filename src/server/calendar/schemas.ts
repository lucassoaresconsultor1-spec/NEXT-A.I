import { z } from "zod";
import { isValidCalendarDay, MAX_YEAR, MIN_YEAR } from "@/lib/business-days";
import { requiredText } from "@/server/forms";

// Pure validation for the company calendar (m32a).

export const HOLIDAY_KINDS = ["holiday", "optional"] as const;
export const HOLIDAY_KIND_LABELS: Record<(typeof HOLIDAY_KINDS)[number], string> = { holiday: "Feriado", optional: "Ponto facultativo" };

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const holidaySchema = z
  .object({
    storeId: z.preprocess(emptyToUndefined, z.uuid({ error: "Selecione uma loja válida." }).optional()),
    day: z.string({ error: "Informe a data." }).refine(isValidCalendarDay, { error: "Informe uma data válida." }),
    name: requiredText("o nome", 80, 2),
    kind: z.enum(HOLIDAY_KINDS, { error: "Escolha o tipo." }),
    closed: z.preprocess((value) => value === true || value === "true" || value === "on", z.boolean()),
  })
  // A holiday always stops work; an optional day only when the company closes.
  .transform((input) => ({ ...input, storeId: input.storeId ?? null, closed: input.kind === "holiday" ? true : input.closed }));
export type HolidayInput = z.input<typeof holidaySchema>;

export const workWeekSchema = z.object({
  weekdays: z
    .array(z.coerce.number().int().min(0, { error: "Dia da semana inválido." }).max(6, { error: "Dia da semana inválido." }), { error: "Escolha os dias de trabalho." })
    .min(1, { error: "Escolha ao menos um dia de trabalho." })
    .max(7)
    .refine((days) => new Set(days).size === days.length, { error: "Dia da semana repetido." })
    .transform((days) => [...days].sort((a, b) => a - b)),
});

export const holidayFiltersSchema = z.object({
  year: z.coerce.number().int().min(MIN_YEAR).max(MAX_YEAR),
  storeId: z.uuid().optional().catch(undefined),
});
export type HolidayFilters = z.input<typeof holidayFiltersSchema>;
