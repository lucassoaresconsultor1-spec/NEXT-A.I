import { z } from "zod";
import { MAX_CENTS } from "@/server/catalog/schemas";
import { requiredText } from "@/server/forms";
import { parsePage } from "@/server/pagination";

// Validation of store expenses (m36a). Money in integer cents.

export const EXPENSE_STATUSES = ["open", "paid", "cancelled"] as const;
export const EXPENSE_STATUS_LABELS: Record<(typeof EXPENSE_STATUSES)[number], string> = { open: "Em aberto", paid: "Paga", cancelled: "Cancelada" };

const day = z.iso.date({ error: "Informe uma data válida." });
const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const categorySchema = z.object({ name: requiredText("o nome", 80, 2) });

export const expenseSchema = z.object({
  storeId: z.uuid({ error: "Selecione a loja." }),
  categoryId: z.uuid({ error: "Selecione a categoria." }),
  competenceDate: day,
  description: requiredText("a descrição", 160, 3),
  amountCents: z.coerce.number({ error: "Informe o valor." }).int({ error: "Informe o valor em centavos." }).min(1, { error: "O valor precisa ser maior que zero." }).max(MAX_CENTS),
  dueDate: z.preprocess(emptyToUndefined, day.optional()),
});
export type ExpenseInput = z.input<typeof expenseSchema>;

export const paySchema = z.object({ paidOn: day });
export const cancelSchema = z.object({ reason: requiredText("o motivo", 240, 3) });

export const expenseFiltersSchema = z.object({
  from: day,
  to: day,
  storeId: z.uuid().optional().catch(undefined),
  categoryId: z.uuid().optional().catch(undefined),
  status: z.enum(EXPENSE_STATUSES).optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type ExpenseFilters = z.input<typeof expenseFiltersSchema>;
