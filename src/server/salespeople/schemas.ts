import { z } from "zod";
import { isValidCalendarDay } from "@/lib/business-days";
import { requiredText } from "@/server/forms";
import { parsePage } from "@/server/pagination";

// Pure validation for salespeople and their monthly schedules (m10a).

export const salespersonSchema = z.object({
  membershipId: z.uuid({ error: "Selecione o membro da equipe." }),
  code: z
    .string({ error: "Informe o código." })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,10}$/, { error: "Use de 1 a 10 letras sem acento ou números." }),
  nickname: requiredText("o apelido", 40, 2),
  storeIds: z.array(z.uuid({ error: "Loja inválida." }), { error: "Escolha as lojas." }).min(1, { error: "Escolha ao menos uma loja." }).max(200),
});
export type SalespersonInput = z.input<typeof salespersonSchema>;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const scheduleSchema = z
  .object({
    salespersonId: z.uuid({ error: "Vendedor inválido." }),
    storeId: z.uuid({ error: "Selecione a loja." }),
    month: z.string({ error: "Informe o mês." }).regex(MONTH, { error: "Informe o mês no formato AAAA-MM." }),
    daysOff: z.array(z.string(), { error: "Informe as folgas." }).max(31, { error: "No máximo 31 folgas no mês." }),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.daysOff.forEach((day, index) => {
      if (!isValidCalendarDay(day) || !day.startsWith(`${input.month}-`)) context.addIssue({ code: "custom", path: ["daysOff", index], message: "A folga tem de ser uma data do mês escolhido." });
      else if (seen.has(day)) context.addIssue({ code: "custom", path: ["daysOff", index], message: "Folga repetida." });
      seen.add(day);
    });
  })
  .transform((input) => ({ ...input, daysOff: [...new Set(input.daysOff)].sort() }));

export const salespeopleFiltersSchema = z.object({
  storeId: z.uuid().optional().catch(undefined),
  status: z.enum(["active", "inactive"]).optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type SalespeopleFilters = z.output<typeof salespeopleFiltersSchema>;
