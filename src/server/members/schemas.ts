import { z } from "zod";
import { emailField, passwordField, requiredText } from "@/server/forms";
import { parseDirection, parsePage, parseSort } from "@/server/pagination";

// Pure validation for the members module: shared by Server Actions (early field
// errors) and by the service (defense in depth for any other caller).

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const STORE_ACCESS_VALUES = ["all", "regions", "stores"] as const;
export const storeAccessSchema = z.enum(STORE_ACCESS_VALUES, { error: "Selecione o escopo de acesso." });

export const memberAccessSchema = z.object({
  roleId: z.uuid({ error: "Selecione um perfil." }),
  storeAccess: storeAccessSchema,
  regionIds: z.array(z.uuid({ error: "Selecione regiões válidas." })).max(500, { error: "Seleção grande demais." }),
  storeIds: z.array(z.uuid({ error: "Selecione lojas válidas." })).max(1000, { error: "Seleção grande demais." }),
});
export type MemberAccessInput = z.output<typeof memberAccessSchema>;

export const addMemberSchema = memberAccessSchema.extend({
  name: requiredText("o nome", 120, 2),
  email: emailField,
  // Only used when the e-mail has no account yet; existing users keep their password.
  initialPassword: z.preprocess(emptyToUndefined, passwordField.optional()),
});
export type AddMemberInput = z.output<typeof addMemberSchema>;

/** Scalar form fields read by the Server Actions (lists are read with pickAll). */
export const ADD_MEMBER_FIELDS = ["name", "email", "roleId", "storeAccess", "initialPassword"] as const;
export const MEMBER_ACCESS_FIELDS = ["roleId", "storeAccess"] as const;

export const MEMBER_STATUS_VALUES = ["active", "suspended"] as const;
export const memberStatusSchema = z.enum(MEMBER_STATUS_VALUES, { error: "Situação inválida." });
export const memberStatusInputSchema = z.object({ status: memberStatusSchema });
export type MemberStatus = z.infer<typeof memberStatusSchema>;

export const temporaryPasswordSchema = z.object({ temporaryPassword: passwordField });

export const MEMBER_SORT_COLUMNS = ["name", "email", "role", "status", "lastLogin"] as const;
export type MemberSortColumn = (typeof MEMBER_SORT_COLUMNS)[number];

export const memberFiltersSchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()).catch(undefined),
  roleId: z.uuid().optional().catch(undefined),
  status: memberStatusSchema.optional().catch(undefined),
  storeId: z.uuid().optional().catch(undefined),
  sort: z.unknown().optional().transform((value) => parseSort(value, MEMBER_SORT_COLUMNS, "name")),
  dir: z.unknown().optional().transform(parseDirection),
  page: z.unknown().optional().transform(parsePage),
});
export type MemberFilters = z.output<typeof memberFiltersSchema>;

const uuidCheck = z.uuid();

/** Ids that are not UUIDs cannot exist; answering early avoids a database cast error. */
export function isUuid(value: string) {
  return uuidCheck.safeParse(value).success;
}
