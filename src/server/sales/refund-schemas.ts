import { z } from "zod";
import { requiredText } from "@/server/forms";
import { MAX_QUANTITY_MILLI, parseQuantityInput, ZERO } from "@/server/inventory/quantity";

// Pure rules for cancellations and returns: validation and the allocation of
// refund amounts in integer cents (no floating point).

export const REFUND_WINDOW_DAYS = 90;

const quantity = z.union([z.string(), z.number()], { error: "Informe a quantidade devolvida." }).transform((value, context) => {
  const milli = parseQuantityInput(String(value));
  if (milli === null || milli <= ZERO || milli > MAX_QUANTITY_MILLI) {
    context.addIssue({ code: "custom", message: "Informe uma quantidade maior que zero, com até 3 casas decimais." });
    return z.NEVER;
  }
  return milli;
});

const nsu = z
  .string({ error: "Informe o NSU do estorno na maquininha." })
  .trim()
  .regex(/^[A-Za-z0-9]{4,20}$/, { error: "Informe o NSU com 4 a 20 letras ou números." });

export const cancelSchema = z.object({
  idempotencyKey: z.uuid({ error: "Chave do cancelamento inválida." }),
  reason: requiredText("o motivo", 240, 3),
  restock: z.preprocess((value) => value === undefined || value === true || value === "true" || value === "on", z.boolean()),
  cardRefundNsu: z.preprocess((value) => (value === "" ? undefined : value), nsu.optional()),
});

export const refundSchema = z
  .object({
    idempotencyKey: z.uuid({ error: "Chave da devolução inválida." }),
    reason: requiredText("o motivo", 240, 3),
    method: z.enum(["cash", "card_external"], { error: "Escolha como devolver o valor." }),
    nsu: z.preprocess((value) => (value === "" ? undefined : value), nsu.optional()),
    items: z
      .array(
        z.object({
          line: z.coerce.number().int().min(1, { error: "Linha inválida." }),
          quantity,
          restock: z.preprocess((value) => value === true || value === "true" || value === "on", z.boolean()),
        }),
        { error: "Informe os itens devolvidos." },
      )
      .min(1, { error: "Informe ao menos um item." })
      .max(300),
  })
  .superRefine((input, context) => {
    if (input.method === "card_external" && !input.nsu) context.addIssue({ code: "custom", path: ["nsu"], message: "Informe o NSU do estorno na maquininha." });
    const seen = new Set<number>();
    input.items.forEach((item, index) => {
      if (seen.has(item.line)) context.addIssue({ code: "custom", path: ["items", index, "line"], message: "Item repetido na devolução." });
      seen.add(item.line);
    });
  });

/** Share of the sale total that a line is worth: its net total adjusted by sale discount/surcharge, rounded down. */
export function effectiveLineCents(lineNetCents: number, sumOfLineNets: number, saleTotalCents: number): number {
  if (sumOfLineNets <= 0) return 0;
  return Number((BigInt(lineNetCents) * BigInt(saleTotalCents)) / BigInt(sumOfLineNets));
}

/** Amount of returning `quantity` of a line; the return that completes the line takes the rounding remainder. */
export function lineReturnCents(effectiveCents: number, soldMilli: bigint, alreadyReturnedMilli: bigint, alreadyRefundedCents: number, quantityMilli: bigint): number {
  if (alreadyReturnedMilli + quantityMilli >= soldMilli) return effectiveCents - alreadyRefundedCents;
  return Number((BigInt(effectiveCents) * quantityMilli) / soldMilli);
}
