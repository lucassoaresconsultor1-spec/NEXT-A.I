import { z } from "zod";
import { BRAZIL_TIMEZONE_VALUES } from "@/lib/brazil";
import { isValidCnpj, isValidPhone, normalizeCnpj, onlyDigits } from "@/lib/documents";
import type { ActionState } from "@/lib/action-state";

// Shared form plumbing for Server Actions: validation, field errors and the
// state shape consumed by useActionState in client forms.

export type { ActionState } from "@/lib/action-state";

export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

export function invalidState(error: z.ZodError): ActionState {
  return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrorsOf(error) };
}

/** Reads only the listed fields; never forwards an entire FormData to a service. */
export function pick(formData: FormData, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, formData.get(field) ?? undefined]));
}

export function pickAll(formData: FormData, field: string) {
  return formData.getAll(field).filter((value): value is string => typeof value === "string");
}

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const requiredText = (label: string, max: number, min = 1) =>
  z
    .string({ error: `Informe ${label}.` })
    .trim()
    .min(min, { error: min > 1 ? `Use ao menos ${min} caracteres.` : `Informe ${label}.` })
    .max(max, { error: `Use no máximo ${max} caracteres.` });

export const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max, { error: `Use no máximo ${max} caracteres.` }).optional());

export const emailField = z
  .string({ error: "Informe o e-mail." })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Informe um e-mail válido." }).max(254));

export const optionalEmail = z.preprocess(emptyToUndefined, emailField.optional());

export const passwordField = z
  .string({ error: "Informe a senha." })
  .min(10, { error: "A senha precisa ter ao menos 10 caracteres." })
  .max(128, { error: "A senha pode ter no máximo 128 caracteres." })
  .refine((value) => !/^(.)\1*$/.test(value), { error: "Escolha uma senha menos previsível." });

export const optionalCnpj = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .transform(normalizeCnpj)
    .refine(isValidCnpj, { error: "CNPJ inválido." })
    .optional(),
);

export const optionalPhone = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .transform(onlyDigits)
    .refine(isValidPhone, { error: "Telefone inválido. Use DDD + número." })
    .optional(),
);

export const timezoneField = z.enum(BRAZIL_TIMEZONE_VALUES, { error: "Selecione um fuso horário válido." });

export const uuidField = z.uuid({ error: "Seleção inválida." });

export const optionalUuid = z.preprocess(emptyToUndefined, uuidField.optional());
