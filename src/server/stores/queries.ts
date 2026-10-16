import "server-only";
import { and, eq, type SQL } from "drizzle-orm";
import { regions, stores } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { fieldErrorsOf } from "@/server/forms";
import { conflict, invalid } from "@/server/errors";
import { storeInputSchema, type StoreInput } from "./schemas";

// Building blocks shared by the stores service: column sets, input mapping,
// and the friendly errors for constraint races.

export const STORE_CODE_CONSTRAINT = "stores_org_code_key";
export const STORE_REGION_CONSTRAINT = "stores_region_fk";

/** Business fields compared for the audit trail (never ids of other tables beyond the region). */
export const STORE_AUDIT_FIELDS = [
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
] as const;

export const storeDetailColumns = {
  id: stores.id,
  code: stores.code,
  name: stores.name,
  document: stores.document,
  phone: stores.phone,
  email: stores.email,
  postalCode: stores.postalCode,
  street: stores.street,
  number: stores.number,
  complement: stores.complement,
  district: stores.district,
  city: stores.city,
  state: stores.state,
  timezone: stores.timezone,
  status: stores.status,
  regionId: stores.regionId,
  createdAt: stores.createdAt,
  updatedAt: stores.updatedAt,
};

/** Join that only matches a region of the same organization (mirrors the composite FK). */
export function regionOfStore(): SQL | undefined {
  return and(eq(regions.organizationId, stores.organizationId), eq(regions.id, stores.regionId));
}

export const codeTaken = () => conflict("Já existe uma loja com este código.", { code: ["Código já utilizado nesta empresa."] });

export const regionUnavailable = () => invalid("Região inválida.", { regionId: ["Selecione uma região da empresa."] });

/** Re-validates input inside the service so callers other than the form get the same rules. */
export function parseStoreInput(input: StoreInput): StoreInput {
  const parsed = storeInputSchema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

/** Column values for insert/update; `regionId` is resolved by the caller. */
export function storeColumns(input: StoreInput) {
  return {
    code: input.code,
    name: input.name,
    document: input.document ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    postalCode: input.postalCode ?? null,
    street: input.street ?? null,
    number: input.number ?? null,
    complement: input.complement ?? null,
    district: input.district ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    timezone: input.timezone ?? null,
  };
}

export async function assertRegionOfOrganization(tx: Tx, organizationId: string, regionId: string) {
  const [found] = await tx
    .select({ id: regions.id })
    .from(regions)
    .where(and(eq(regions.organizationId, organizationId), eq(regions.id, regionId)));
  if (!found) throw regionUnavailable();
}

/** Drops empty values so the creation entry lists only what was filled in. */
export function filledFields(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined));
}
