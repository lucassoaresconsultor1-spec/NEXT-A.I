import { z } from "zod";
import { optionalText, requiredText } from "@/server/forms";

// Validation of the store service queue (m13a).

export const arrivalSchema = z.object({
  storeId: z.uuid({ error: "Selecione a loja." }),
  requestKey: z.uuid({ error: "Chave da chegada inválida." }),
  note: optionalText(80),
  departmentId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid({ error: "Setor inválido." }).optional()),
});

export const presenceSchema = z.object({
  storeId: z.uuid({ error: "Selecione a loja." }),
  salespersonId: z.uuid({ error: "Vendedor inválido." }),
  status: z.enum(["available", "away"], { error: "Situação inválida." }),
});

export const manualSchema = z.object({
  salespersonId: z.uuid({ error: "Selecione o vendedor." }),
  reason: requiredText("o motivo", 240, 3),
});

export const finishSchema = z.discriminatedUnion(
  "outcome",
  [
    z.object({ outcome: z.literal("sale"), saleId: z.uuid({ error: "Venda inválida." }) }),
    z.object({ outcome: z.literal("no_sale"), reason: requiredText("o motivo", 240, 3) }),
  ],
  { error: "Informe como terminou o atendimento." },
);

export const abandonSchema = z.object({ reason: requiredText("o motivo", 240, 3) });

const day = z.iso.date({ error: "Informe uma data válida." });
export const statsSchema = z
  .object({ storeId: z.uuid().optional(), from: day, to: day })
  .refine((input) => input.from <= input.to, { error: "A data final não pode ser anterior à inicial.", path: ["to"] });
