import { z } from "zod";
import { optionalText, optionalUuid, requiredText } from "@/server/forms";
import { parsePage } from "@/server/pagination";
import { MAX_QUANTITY_MILLI, parseQuantityInput, ZERO } from "./quantity";

// Pure validation for batch stock counts. Quantities leave the schemas in thousandths.

export const COUNT_STATUSES = ["open", "approved", "cancelled"] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];

export const COUNT_STATUS_LABELS: Record<CountStatus, string> = {
  open: "Em contagem",
  approved: "Aprovado",
  cancelled: "Cancelado",
};

/** Items a single count may hold; a larger store is counted by category or brand. */
export const MAX_COUNT_ITEMS = 5000;
/** Counted quantities accepted per submission. */
export const MAX_COUNTED_PER_SUBMIT = 500;

export const openCountSchema = z.object({
  storeId: z.uuid({ error: "Selecione a loja." }),
  categoryId: optionalUuid,
  brandId: optionalUuid,
  note: optionalText(500),
});

const counted = z.union([z.string(), z.number()], { error: "Informe a quantidade contada." }).transform((value, context) => {
  const milli = parseQuantityInput(String(value));
  if (milli === null || milli < ZERO || milli > MAX_QUANTITY_MILLI) {
    context.addIssue({ code: "custom", message: "Informe zero ou mais, com até 3 casas decimais." });
    return z.NEVER;
  }
  return milli;
});

export const recordCountSchema = z
  .object({
    items: z
      .array(z.object({ itemId: z.uuid({ error: "Item inválido." }), countedQuantity: counted }), { error: "Informe as quantidades contadas." })
      .min(1, { error: "Informe ao menos uma quantidade." })
      .max(MAX_COUNTED_PER_SUBMIT, { error: `Envie no máximo ${MAX_COUNTED_PER_SUBMIT} itens por vez.` }),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.items.forEach((item, index) => {
      if (seen.has(item.itemId)) context.addIssue({ code: "custom", path: ["items", index, "itemId"], message: "Item repetido." });
      seen.add(item.itemId);
    });
  });

export const approveCountSchema = z.object({ reason: requiredText("o motivo", 240, 3) });
export const cancelCountSchema = z.object({ reason: requiredText("o motivo", 240, 3) });

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const countFiltersSchema = z.object({
  status: z.enum(COUNT_STATUSES).optional().catch(undefined),
  storeId: z.uuid().optional().catch(undefined),
  number: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(2_147_483_647).optional()).catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type CountFilters = z.output<typeof countFiltersSchema>;
