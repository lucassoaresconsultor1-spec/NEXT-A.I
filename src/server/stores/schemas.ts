import { z } from "zod";
import { BRAZIL_STATES } from "@/lib/brazil";
import { isValidCep, onlyDigits } from "@/lib/documents";
import { optionalCnpj, optionalEmail, optionalPhone, optionalText, requiredText, timezoneField } from "@/server/forms";
import { parseDirection, parsePage, parseSort } from "@/server/pagination";

// Pure validation for the stores module: shared by Server Actions (early field
// errors) and by the service (defense in depth for any other caller).

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const STORE_CODE_PATTERN = /^[A-Z0-9-]{1,16}$/;

const codeField = z
  .string({ error: "Informe o código da loja." })
  .trim()
  .toUpperCase()
  .min(1, { error: "Informe o código da loja." })
  .max(16, { error: "Use no máximo 16 caracteres." })
  .regex(STORE_CODE_PATTERN, { error: "Use apenas letras sem acento, números e hífen." });

const optionalCep = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .transform(onlyDigits)
    .refine(isValidCep, { error: "CEP inválido. Use os 8 dígitos." })
    .optional(),
);

const optionalState = z.preprocess(
  (value) => (typeof value === "string" ? emptyToUndefined(value.trim().toUpperCase()) : value),
  z.enum(BRAZIL_STATES, { error: "Selecione uma UF válida." }).optional(),
);

const optionalTimezone = z.preprocess(emptyToUndefined, timezoneField.optional());

/**
 * `undefined` = field not sent (keep the current region on update),
 * empty string or `null` = no region, otherwise a region id.
 */
const regionField = z.preprocess(
  (value) => (value === "" ? null : value),
  z.uuid({ error: "Selecione uma região válida." }).nullable().optional(),
);

export const storeInputSchema = z.object({
  code: codeField,
  name: requiredText("o nome da loja", 120, 2),
  document: optionalCnpj,
  phone: optionalPhone,
  email: optionalEmail,
  postalCode: optionalCep,
  street: optionalText(160),
  number: optionalText(16),
  complement: optionalText(80),
  district: optionalText(80),
  city: optionalText(80),
  state: optionalState,
  timezone: optionalTimezone,
  regionId: regionField,
});
export type StoreInput = z.output<typeof storeInputSchema>;

/** Form field names, in the order the form sends them. */
export const STORE_FORM_FIELDS = [
  "code",
  "name",
  "document",
  "phone",
  "email",
  "postalCode",
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
  "timezone",
  "regionId",
] as const satisfies readonly (keyof StoreInput)[];

export const storeStatusSchema = z.enum(["active", "inactive"], { error: "Situação inválida." });
export type StoreStatus = z.infer<typeof storeStatusSchema>;

export const STORE_SORT_COLUMNS = ["code", "name", "city", "region", "status"] as const;
export type StoreSortColumn = (typeof STORE_SORT_COLUMNS)[number];

/** Region filter: a region id, or "none" for stores without a region. */
export const NO_REGION_FILTER = "none";

export const storeFiltersSchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()).catch(undefined),
  status: storeStatusSchema.optional().catch(undefined),
  regionId: z.union([z.literal(NO_REGION_FILTER), z.uuid()]).optional().catch(undefined),
  // `.optional()` lets callers omit keys entirely (an absent key differs from `undefined` in Zod 4).
  sort: z.unknown().optional().transform((value) => parseSort(value, STORE_SORT_COLUMNS, "name")),
  dir: z.unknown().optional().transform(parseDirection),
  page: z.unknown().optional().transform(parsePage),
});
export type StoreFilters = z.output<typeof storeFiltersSchema>;

const uuidCheck = z.uuid();

/** Ids that are not UUIDs cannot exist; answering early avoids a database cast error. */
export function isUuid(value: string) {
  return uuidCheck.safeParse(value).success;
}
