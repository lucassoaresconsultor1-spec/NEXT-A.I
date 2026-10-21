import { z } from "zod";
import { MAX_CENTS } from "@/server/catalog/schemas";

// Pure validation for provider payment intents.

export const PROVIDER_METHODS = ["pix", "card_provider"] as const;
export const INTENT_EXPIRATION_SECONDS = 15 * 60;
export const MAX_WEBHOOK_BYTES = 64 * 1024;

export const createIntentSchema = z.object({
  storeId: z.uuid({ error: "Selecione uma loja válida." }),
  method: z.enum(PROVIDER_METHODS, { error: "Forma de pagamento inválida." }),
  amountCents: z.coerce
    .number({ error: "Informe o valor." })
    .int({ error: "Informe o valor em centavos inteiros." })
    .min(1, { error: "O valor precisa ser maior que zero." })
    .max(MAX_CENTS, { error: "Valor acima do permitido." }),
  idempotencyKey: z.uuid({ error: "Chave do pagamento inválida." }),
});
export type CreateIntentInput = z.input<typeof createIntentSchema>;

/** Allowed status transitions of an intent; anything else is recorded and ignored. */
const TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["confirmed", "failed", "cancelled"],
  confirmed: ["refunded"],
};

export function canTransition(from: string, to: string) {
  return (TRANSITIONS[from] ?? []).includes(to);
}
