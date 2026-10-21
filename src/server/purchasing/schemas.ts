import { z } from "zod";
import { MAX_CENTS } from "@/server/catalog/schemas";
import { optionalText, requiredText } from "@/server/forms";
import { MAX_QUANTITY_MILLI, parseQuantityInput, ZERO } from "@/server/inventory/quantity";
import { parsePage } from "@/server/pagination";

// Pure validation for purchase orders and goods receipts. Quantities leave the
// schemas in thousandths (bigint); money in integer cents.

export const PURCHASE_ORDER_STATUSES = ["draft", "approved", "partially_received", "received", "cancelled"] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Rascunho",
  approved: "Aprovado",
  partially_received: "Recebido em parte",
  received: "Recebido",
  cancelled: "Cancelado",
};

export const MAX_ORDER_ITEMS = 200;

const QUANTITY_MESSAGE = "Informe uma quantidade maior que zero, com até 3 casas decimais.";

/** Positive quantity in thousandths, from a form string ("2,5") or a number. */
export const positiveQuantity = z.union([z.string(), z.number()], { error: QUANTITY_MESSAGE }).transform((value, context) => {
  const milli = parseQuantityInput(String(value));
  if (milli === null || milli <= ZERO || milli > MAX_QUANTITY_MILLI) {
    context.addIssue({ code: "custom", message: QUANTITY_MESSAGE });
    return z.NEVER;
  }
  return milli;
});

const cents = z.coerce
  .number({ error: "Informe o custo unitário." })
  .int({ error: "Informe o custo em centavos inteiros." })
  .min(0, { error: "O custo não pode ser negativo." })
  .max(MAX_CENTS, { error: "Valor acima do permitido." });

const uuid = (message: string) => z.uuid({ error: message });

/** Flags repeated values of `key` with an issue on the repeated item. */
function noRepeated<T>(items: T[], key: keyof T, message: string, context: z.RefinementCtx) {
  const seen = new Set<unknown>();
  items.forEach((item, index) => {
    if (seen.has(item[key])) context.addIssue({ code: "custom", path: ["items", index, String(key)], message });
    seen.add(item[key]);
  });
}

const orderItemSchema = z.object({
  variantId: uuid("Selecione um produto válido."),
  quantity: positiveQuantity,
  unitCostCents: cents,
});

export const purchaseOrderInputSchema = z
  .object({
    storeId: uuid("Selecione uma loja válida."),
    supplierId: uuid("Selecione um fornecedor válido."),
    expectedDate: z.preprocess((value) => (value === "" ? undefined : value), z.iso.date({ error: "Informe uma data válida." }).optional()),
    notes: optionalText(500),
    items: z
      .array(orderItemSchema, { error: "Informe os itens do pedido." })
      .min(1, { error: "Inclua ao menos um item." })
      .max(MAX_ORDER_ITEMS, { error: `Use no máximo ${MAX_ORDER_ITEMS} itens por pedido.` }),
  })
  .superRefine((input, context) => noRepeated(input.items, "variantId", "Produto repetido no pedido.", context));
export type PurchaseOrderInput = z.input<typeof purchaseOrderInputSchema>;
export type ParsedPurchaseOrderInput = z.output<typeof purchaseOrderInputSchema>;

export const receiptInputSchema = z
  .object({
    idempotencyKey: uuid("Chave de recebimento inválida."),
    notes: optionalText(500),
    items: z
      .array(z.object({ orderItemId: uuid("Item inválido."), quantity: positiveQuantity }), { error: "Informe os itens recebidos." })
      .min(1, { error: "Informe a quantidade recebida de ao menos um item." })
      .max(MAX_ORDER_ITEMS, { error: `Use no máximo ${MAX_ORDER_ITEMS} itens por recebimento.` }),
  })
  .superRefine((input, context) => noRepeated(input.items, "orderItemId", "Item repetido no recebimento.", context));
export type ReceiptInput = z.input<typeof receiptInputSchema>;

export const reasonSchema = z.object({ reason: requiredText("o motivo", 240, 3) });

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const purchaseOrderFiltersSchema = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES).optional().catch(undefined),
  storeId: z.uuid().optional().catch(undefined),
  supplierId: z.uuid().optional().catch(undefined),
  number: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(2_147_483_647).optional()).catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type PurchaseOrderFilters = z.output<typeof purchaseOrderFiltersSchema>;
