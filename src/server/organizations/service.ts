import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { organizations } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { diffFields, recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide } from "@/server/authz/guard";
import { conflict, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf, optionalCnpj, optionalText, requiredText, timezoneField } from "@/server/forms";
import { countUsage, getOrganizationPlan } from "@/server/plans/entitlements";

// Organization profile (Configurações). Plan and status are platform-managed
// (src/server/platform) and are never written from here.

export const organizationProfileSchema = z.object({
  name: requiredText("o nome da empresa", 120, 2),
  legalName: optionalText(160),
  document: optionalCnpj,
  timezone: timezoneField,
});
export type OrganizationProfileInput = z.infer<typeof organizationProfileSchema>;

const PROFILE_FIELDS = ["name", "legalName", "document", "timezone"] as const;

export const DOCUMENT_CONSTRAINT = "organizations_document_unique";

const documentTaken = () =>
  conflict("Já existe uma empresa com este CNPJ na plataforma.", { document: ["CNPJ já cadastrado em outra empresa."] });

/**
 * Profile, plan and usage of the active organization. Usage counts cover the
 * whole organization, so they are only returned to organization-wide members
 * (store-scoped readers get `usage: null`).
 */
export async function getOrganizationProfile(context: TenantContext) {
  assertCan(context, "organization.settings.read");
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const [organization] = await tx
      .select({
        id: organizations.id,
        name: organizations.name,
        legalName: organizations.legalName,
        document: organizations.document,
        timezone: organizations.timezone,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!organization) return null;
    const plan = await getOrganizationPlan(tx, orgId);
    const usage = context.storeScope.all ? await countUsage(tx, orgId) : null;
    return { ...organization, plan, usage };
  });
}

/** Updates name, legal name, CNPJ and time zone; returns whether anything changed. */
export async function updateOrganizationProfile(context: TenantContext, input: OrganizationProfileInput) {
  assertCan(context, "organization.settings.manage");
  assertOrganizationWide(context);
  // Re-validated here so callers other than the form get the same rules.
  const parsed = organizationProfileSchema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  const orgId = context.organization.id;
  const next = {
    name: parsed.data.name,
    legalName: parsed.data.legalName ?? null,
    document: parsed.data.document ?? null,
    timezone: parsed.data.timezone,
  };
  try {
    return await withScope(dbScope(context), async (tx) => {
      const [current] = await tx
        .select({
          name: organizations.name,
          legalName: organizations.legalName,
          document: organizations.document,
          timezone: organizations.timezone,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      if (!current) throw notFound("Empresa não encontrada.");
      const changes = diffFields(current, next, PROFILE_FIELDS);
      if (Object.keys(changes).length === 0) return { changed: false };
      // Explicit column list: plan_key and status are deliberately absent.
      await tx
        .update(organizations)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(organizations.id, orgId));
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "organization.updated",
        entityType: "organization",
        entityId: orgId,
        changes,
      });
      return { changed: true };
    });
  } catch (error) {
    if (isUniqueViolation(error, DOCUMENT_CONSTRAINT)) throw documentTaken();
    throw error;
  }
}
