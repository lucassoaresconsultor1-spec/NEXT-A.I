import { z } from "zod";
import { MAX_CENTS } from "@/server/catalog/schemas";
import { optionalText, requiredText } from "@/server/forms";
import { MAX_QUANTITY_MILLI, parseQuantityInput, ZERO } from "@/server/inventory/quantity";
import { parsePage } from "@/server/pagination";

// Pure validation for POS sales. The client only sends intent (items,
// quantities, requested discounts, payments); prices, costs, totals, change and
// numbers are computed by the server.

export const PAYMENT_METHODS = ["cash", "card_external", "pix", "card_provider"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Dinheiro",
  card_external: "Cartão (maquininha)",
  pix: "PIX",
  card_provider: "Cartão",
};

export const SALE_STATUSES = ["suspended", "completed", "discarded", "cancelled"] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  suspended: "Suspensa",
  completed: "Finalizada",
  discarded: "Descartada",
  cancelled: "Cancelada",
};

export const MAX_SALE_ITEMS = 300;
export const MAX_SALE_PAYMENTS = 10;

const QUANTITY_MESSAGE = "Informe uma quantidade maior que zero, com até 3 casas decimais.";

const quantity = z.union([z.string(), z.number()], { error: QUANTITY_MESSAGE }).transform((value, context) => {
  const milli = parseQuantityInput(String(value));
  if (milli === null || milli <= ZERO || milli > MAX_QUANTITY_MILLI) {
    context.addIssue({ code: "custom", message: QUANTITY_MESSAGE });
    return z.NEVER;
  }
  return milli;
});

const cents = (min = 0) =>
  z.coerce
    .number({ error: "Informe um valor em centavos." })
    .int({ error: "Informe o valor em centavos inteiros." })
    .min(min, { error: min > 0 ? "O valor precisa ser maior que zero." : "O valor não pode ser negativo." })
    .max(MAX_CENTS, { error: "Valor acima do permitido." });

const optionalId = z.preprocess((value) => (value === "" || value === null ? undefined : value), z.uuid({ error: "Seleção inválida." }).optional());

function noRepeatedVariant(items: { variantId: string }[], context: z.RefinementCtx) {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.variantId)) context.addIssue({ code: "custom", path: ["items", index, "variantId"], message: "Produto repetido na venda; ajuste a quantidade." });
    seen.add(item.variantId);
  });
}

const saleItem = z.object({
  variantId: z.uuid({ error: "Selecione um produto válido." }),
  quantity,
  expectedUnitPriceCents: cents(),
  discountCents: cents().default(0),
});

const payment = z.discriminatedUnion(
  "method",
  [
    z
      .object({ method: z.literal("cash"), amountCents: cents(1), tenderedCents: cents(1) })
      .refine((value) => value.tenderedCents >= value.amountCents, { path: ["tenderedCents"], message: "O valor recebido não cobre o pagamento em dinheiro." }),
    z.object({
      method: z.literal("card_external"),
      amountCents: cents(1),
      nsu: z
        .string({ error: "Informe o NSU do comprovante da maquininha." })
        .trim()
        .regex(/^[A-Za-z0-9]{4,20}$/, { error: "Informe o NSU com 4 a 20 letras ou números." }),
      brand: optionalText(30),
    }),
    // Provider payments (m07): only an intent the provider already confirmed.
    z.object({
      method: z.enum(["pix", "card_provider"]),
      amountCents: cents(1),
      paymentIntentId: z.uuid({ error: "Pagamento integrado inválido." }),
    }),
  ],
  { error: "Forma de pagamento não disponível no PDV." },
);

export const completeSaleSchema = z
  .object({
    completionKey: z.uuid({ error: "Chave de finalização inválida." }),
    storeId: z.uuid({ error: "Selecione uma loja válida." }),
    suspendedSaleId: optionalId,
    customerId: optionalId,
    salespersonUserId: optionalId,
    items: z
      .array(saleItem, { error: "Inclua os itens da venda." })
      .min(1, { error: "Inclua ao menos um item." })
      .max(MAX_SALE_ITEMS, { error: `Use no máximo ${MAX_SALE_ITEMS} itens por venda.` }),
    saleDiscountCents: cents().default(0),
    surchargeCents: cents().default(0),
    payments: z
      .array(payment, { error: "Informe os pagamentos." })
      .min(1, { error: "Informe ao menos um pagamento." })
      .max(MAX_SALE_PAYMENTS, { error: `Use no máximo ${MAX_SALE_PAYMENTS} pagamentos.` }),
    notes: optionalText(500),
  })
  .superRefine((input, context) => noRepeatedVariant(input.items, context));
export type CompleteSaleInput = z.input<typeof completeSaleSchema>;
export type ParsedCompleteSale = z.output<typeof completeSaleSchema>;

export const suspendSaleSchema = z
  .object({
    // Optional for compatibility; the POS always sends it so a repeated submission returns the same suspension.
    suspensionKey: z.uuid({ error: "Chave da suspensão inválida." }).optional(),
    storeId: z.uuid({ error: "Selecione uma loja válida." }),
    customerId: optionalId,
    salespersonUserId: optionalId,
    items: z
      .array(z.object({ variantId: z.uuid({ error: "Selecione um produto válido." }), quantity }), { error: "Inclua os itens da venda." })
      .min(1, { error: "Inclua ao menos um item." })
      .max(MAX_SALE_ITEMS, { error: `Use no máximo ${MAX_SALE_ITEMS} itens por venda.` }),
    note: optionalText(240),
  })
  .superRefine((input, context) => noRepeatedVariant(input.items, context));

export const discardSchema = z.object({ reason: requiredText("o motivo", 240, 3) });

export const saleFiltersSchema = z.object({
  storeId: z.uuid().optional().catch(undefined),
  status: z.enum(SALE_STATUSES).optional().catch(undefined),
  number: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().int().min(1).max(2_147_483_647).optional()).catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  operatorUserId: z.uuid().optional().catch(undefined),
  customerId: z.uuid().optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type SaleFilters = z.output<typeof saleFiltersSchema>;
