import { z } from "zod";
import { isValidCpf, onlyDigits } from "@/lib/documents";
import { optionalEmail, optionalPhone, requiredText } from "@/server/forms";
import { parsePage } from "@/server/pagination";

// Pure validation and masks for customer data (LGPD minimization, ADR-017).

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const cpfField = z.preprocess(
  emptyToUndefined,
  z
    .string({ error: "CPF inválido." })
    .transform(onlyDigits)
    .refine(isValidCpf, { error: "CPF inválido." })
    .optional(),
);

const consentField = z.preprocess((value) => value === true || value === "on" || value === "true", z.boolean());

export const customerInputSchema = z
  .object({
    name: requiredText("o nome do cliente", 120, 2),
    document: cpfField,
    email: optionalEmail,
    phone: optionalPhone,
    marketingConsent: consentField,
  })
  .transform((input) => ({
    name: input.name,
    document: input.document ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    marketingConsent: input.marketingConsent,
  }));
export type CustomerInput = z.output<typeof customerInputSchema>;

export const customerFiltersSchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()).catch(undefined),
  status: z.enum(["active", "inactive"]).optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type CustomerFilters = z.output<typeof customerFiltersSchema>;

/** "12345678909" -> "***.456.789-**". Anything that is not 11 digits -> "***". */
export function maskCpf(document: string): string {
  if (!/^\d{11}$/.test(document)) return "***";
  return `***.${document.slice(3, 6)}.${document.slice(6, 9)}-**`;
}

/** "ana.souza@exemplo.com" -> "a***@exemplo.com". */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** "21987654321" -> "(21) *****-4321"; "2134567890" -> "(21) ****-7890". */
export function maskPhone(phone: string): string {
  if (!/^\d{10,11}$/.test(phone)) return "***";
  return `(${phone.slice(0, 2)}) ${"*".repeat(phone.length - 6)}-${phone.slice(-4)}`;
}
