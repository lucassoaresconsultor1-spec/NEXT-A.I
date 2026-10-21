import { z } from "zod";
import { requiredText } from "@/server/forms";
import { parsePage } from "@/server/pagination";
import { MAX_QUANTITY_MILLI, parseQuantityInput, ZERO, type MovementType } from "./quantity";

// Pure validation for manual stock movements and ledger filters.

export const MOVEMENT_TYPES = ["entry", "exit", "adjustment", "loss", "count"] as const satisfies readonly MovementType[];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  entry: "Entrada",
  exit: "Saída",
  adjustment: "Ajuste",
  loss: "Perda",
  count: "Inventário",
};

const QUANTITY_RULES: Record<MovementType, { accepts: (milli: bigint) => boolean; message: string }> = {
  entry: { accepts: (milli) => milli > ZERO, message: "Informe uma quantidade maior que zero." },
  exit: { accepts: (milli) => milli > ZERO, message: "Informe uma quantidade maior que zero." },
  loss: { accepts: (milli) => milli > ZERO, message: "Informe uma quantidade maior que zero." },
  adjustment: { accepts: (milli) => milli !== ZERO, message: "Informe um ajuste diferente de zero (negativo para reduzir)." },
  count: { accepts: (milli) => milli >= ZERO, message: "Informe a quantidade contada (zero ou mais)." },
};

const QUANTITY_FORMAT = "Use até 11 dígitos inteiros e 3 decimais (ex.: 12 ou 0,5).";

/**
 * `quantity` is what the user types: the amount moved for entry/exit/loss,
 * a signed correction for adjustment and the counted total for count.
 * Output carries it in thousandths (`quantityMilli`).
 */
export const movementInputSchema = z
  .object({
    storeId: z.uuid({ error: "Selecione uma loja válida." }),
    variantId: z.uuid({ error: "Selecione um produto válido." }),
    type: z.enum(MOVEMENT_TYPES, { error: "Tipo de movimentação inválido." }),
    quantity: z.union([z.string(), z.number()], { error: "Informe a quantidade." }).transform(String),
    reason: requiredText("o motivo", 240, 3),
  })
  .transform((input, context) => {
    const milli = parseQuantityInput(input.quantity);
    if (milli === null || milli > MAX_QUANTITY_MILLI || -milli > MAX_QUANTITY_MILLI) {
      context.addIssue({ code: "custom", path: ["quantity"], message: QUANTITY_FORMAT });
      return z.NEVER;
    }
    const rule = QUANTITY_RULES[input.type];
    if (!rule.accepts(milli)) {
      context.addIssue({ code: "custom", path: ["quantity"], message: rule.message });
      return z.NEVER;
    }
    return { storeId: input.storeId, variantId: input.variantId, type: input.type, quantityMilli: milli, reason: input.reason };
  });
export type MovementInput = z.input<typeof movementInputSchema>;
export type ParsedMovementInput = z.output<typeof movementInputSchema>;

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const idFilter = z.uuid().optional().catch(undefined);

export const balanceFiltersSchema = z.object({
  storeId: idFilter,
  variantId: idFilter,
  q: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()).catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type BalanceFilters = z.output<typeof balanceFiltersSchema>;

export const movementFiltersSchema = z.object({
  storeId: idFilter,
  variantId: idFilter,
  type: z.enum(MOVEMENT_TYPES).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type MovementFilters = z.output<typeof movementFiltersSchema>;
