import { z } from "zod";
import { parsePage } from "@/server/pagination";
import { DRILL_DOWN_METRICS } from "./definitions";

// Filters of the sales metrics: calendar dates in the store time zone (store, or
// the organization when the store has none), both ends included, up to 366 days.

export const MAX_PERIOD_DAYS = 366;
export const GROUP_BY = ["day", "week", "month", "store", "salesperson", "operator"] as const;
export type MetricsGroupBy = (typeof GROUP_BY)[number];

const day = z.iso.date({ error: "Informe uma data válida." });

export const metricsFiltersSchema = z
  .object({
    from: day,
    to: day,
    storeIds: z.array(z.uuid({ error: "Loja inválida." })).max(500).optional(),
    salespersonUserId: z.uuid({ error: "Vendedor inválido." }).optional(),
    operatorUserId: z.uuid({ error: "Operador inválido." }).optional(),
  })
  .superRefine((input, context) => {
    const span = (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000 + 1;
    if (span < 1) context.addIssue({ code: "custom", path: ["to"], message: "A data final não pode ser anterior à inicial." });
    else if (span > MAX_PERIOD_DAYS) context.addIssue({ code: "custom", path: ["to"], message: `Escolha um período de até ${MAX_PERIOD_DAYS} dias.` });
  });
export type MetricsFilters = z.input<typeof metricsFiltersSchema>;

export const seriesSchema = z.object({ groupBy: z.enum(GROUP_BY, { error: "Agrupamento inválido." }) });
export const drillDownSchema = z.object({
  metric: z.enum(DRILL_DOWN_METRICS, { error: "Métrica inválida." }),
  page: z.unknown().optional().transform(parsePage),
});
