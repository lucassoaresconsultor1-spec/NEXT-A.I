import { z } from "zod";
import { MAX_CENTS } from "@/server/catalog/schemas";
import { optionalText, requiredText } from "@/server/forms";
import { parsePage } from "@/server/pagination";

// Pure validation for cash registers and sessions. Amounts are integer cents
// (forms convert reais with parseBrlToCents before calling the service).

export const CASH_MOVEMENT_TYPES = ["opening", "supply", "withdrawal", "sale", "refund"] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const CASH_MOVEMENT_LABELS: Record<CashMovementType, string> = {
  opening: "Abertura",
  supply: "Suprimento",
  withdrawal: "Sangria",
  sale: "Venda em dinheiro",
  refund: "Devolução em dinheiro",
};

const amount = (min: number, label: string) =>
  z.coerce
    .number({ error: `Informe ${label}.` })
    .int({ error: "Informe o valor em centavos inteiros." })
    .min(min, { error: min > 0 ? "O valor precisa ser maior que zero." : "O valor não pode ser negativo." })
    .max(MAX_CENTS, { error: "Valor acima do permitido." });

export const registerInputSchema = z.object({
  storeId: z.uuid({ error: "Selecione uma loja válida." }),
  name: requiredText("o nome do caixa", 60, 2),
});

export const registerNameSchema = z.object({ name: requiredText("o nome do caixa", 60, 2) });

export const openSessionSchema = z.object({
  registerId: z.uuid({ error: "Selecione um caixa válido." }),
  openingAmountCents: amount(0, "o troco inicial"),
  idempotencyKey: z.uuid({ error: "Chave de abertura inválida." }),
});

export const manualMovementSchema = z.object({
  type: z.enum(["supply", "withdrawal"], { error: "Escolha suprimento ou sangria." }),
  amountCents: amount(1, "o valor"),
  reason: requiredText("o motivo", 240, 3),
  idempotencyKey: z.uuid({ error: "Chave do movimento inválida." }),
});

export const closeSessionSchema = z.object({
  countedAmountCents: amount(0, "o valor contado"),
  note: optionalText(500),
});

export const reopenSchema = z.object({ reason: requiredText("o motivo", 240, 3) });

export const sessionFiltersSchema = z.object({
  storeId: z.uuid().optional().catch(undefined),
  registerId: z.uuid().optional().catch(undefined),
  status: z.enum(["open", "closed"]).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type SessionFilters = z.output<typeof sessionFiltersSchema>;
