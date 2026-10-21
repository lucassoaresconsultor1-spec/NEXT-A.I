import { z } from "zod";
import { optionalText, requiredText } from "@/server/forms";
import { parsePage } from "@/server/pagination";
import { MAX_QUANTITY_MILLI, parseQuantityInput, ZERO } from "./quantity";

// Pure validation for stock transfers. Quantities leave the schemas in thousandths.

export const TRANSFER_STATUSES = ["requested", "approved", "in_transit", "received", "cancelled"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  requested: "Solicitada",
  approved: "Aprovada",
  in_transit: "Em trânsito",
  received: "Recebida",
  cancelled: "Cancelada",
};

export const MAX_TRANSFER_ITEMS = 200;

const quantity = (options: { allowZero: boolean }) => {
  const message = options.allowZero ? "Informe zero ou mais, com até 3 casas decimais." : "Informe uma quantidade maior que zero, com até 3 casas decimais.";
  return z.union([z.string(), z.number()], { error: message }).transform((value, context) => {
    const milli = parseQuantityInput(String(value));
    if (milli === null || milli < ZERO || (!options.allowZero && milli === ZERO) || milli > MAX_QUANTITY_MILLI) {
      context.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return milli;
  });
};

function noRepeated<T>(items: T[], key: keyof T, message: string, context: z.RefinementCtx) {
  const seen = new Set<unknown>();
  items.forEach((item, index) => {
    if (seen.has(item[key])) context.addIssue({ code: "custom", path: ["items", index, String(key)], message });
    seen.add(item[key]);
  });
}

export const transferRequestSchema = z
  .object({
    originStoreId: z.uuid({ error: "Selecione a loja de origem." }),
    destinationStoreId: z.uuid({ error: "Selecione a loja de destino." }),
    notes: optionalText(500),
    items: z
      .array(z.object({ variantId: z.uuid({ error: "Selecione um produto válido." }), quantity: quantity({ allowZero: false }) }), {
        error: "Informe os itens da transferência.",
      })
      .min(1, { error: "Inclua ao menos um item." })
      .max(MAX_TRANSFER_ITEMS, { error: `Use no máximo ${MAX_TRANSFER_ITEMS} itens por transferência.` }),
  })
  .superRefine((input, context) => {
    if (input.originStoreId === input.destinationStoreId) {
      context.addIssue({ code: "custom", path: ["destinationStoreId"], message: "Escolha uma loja de destino diferente da origem." });
    }
    noRepeated(input.items, "variantId", "Produto repetido na transferência.", context);
  });
export type TransferRequestInput = z.input<typeof transferRequestSchema>;

export const dispatchSchema = z
  .object({
    items: z
      .array(z.object({ itemId: z.uuid({ error: "Item inválido." }), quantitySent: quantity({ allowZero: true }) }))
      .max(MAX_TRANSFER_ITEMS)
      .default([]),
  })
  .superRefine((input, context) => noRepeated(input.items, "itemId", "Item repetido.", context));

export const receiveSchema = z
  .object({
    items: z
      .array(z.object({ itemId: z.uuid({ error: "Item inválido." }), quantityReceived: quantity({ allowZero: true }) }))
      .max(MAX_TRANSFER_ITEMS)
      .default([]),
    divergenceReason: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      requiredText("o motivo da diferença", 240, 3).optional(),
    ),
  })
  .superRefine((input, context) => noRepeated(input.items, "itemId", "Item repetido.", context));

export const cancelTransferSchema = z.object({ reason: requiredText("o motivo", 240, 3) });

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const transferFiltersSchema = z.object({
  status: z.enum(TRANSFER_STATUSES).optional().catch(undefined),
  storeId: z.uuid().optional().catch(undefined),
  number: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(2_147_483_647).optional()).catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type TransferFilters = z.output<typeof transferFiltersSchema>;
