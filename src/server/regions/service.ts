import "server-only";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { membershipRegions, regions, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { diffFields, recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide } from "@/server/authz/guard";
import { conflict, invalid, isForeignKeyViolation, isUniqueViolation, notFound } from "@/server/errors";
import { optionalText, requiredText } from "@/server/forms";

export const regionInputSchema = z.object({
  name: requiredText("o nome da região", 80, 2),
  description: optionalText(240),
});
export type RegionInput = z.infer<typeof regionInputSchema>;

const NAME_TAKEN = () => conflict("Já existe uma região com este nome.", { name: ["Nome já utilizado."] });

/**
 * Organization-wide members see every region; scoped members only see regions
 * that contain at least one store they can access, with counts limited to them.
 */
export async function listRegions(context: TenantContext) {
  assertCan(context, "regions.read");
  const orgId = context.organization.id;
  const scoped = storeScopeCondition(context.storeScope, stores.id);
  return withScope(dbScope(context), async (tx) => {
    const rows = await tx
      .select({
        id: regions.id,
        name: regions.name,
        description: regions.description,
        storeCount: sql<number>`count(${stores.id})::int`,
      })
      .from(regions)
      .leftJoin(stores, and(eq(stores.organizationId, regions.organizationId), eq(stores.regionId, regions.id), scoped))
      .where(eq(regions.organizationId, orgId))
      .groupBy(regions.id)
      .orderBy(asc(regions.name))
      .limit(500);
    return context.storeScope.all ? rows : rows.filter((row) => row.storeCount > 0);
  });
}

/** Options for selects (store form, member scope). */
export async function listRegionOptions(context: TenantContext) {
  const rows = await listRegions(context);
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function createRegion(context: TenantContext, input: RegionInput) {
  assertCan(context, "regions.manage");
  assertOrganizationWide(context);
  try {
    return await withScope(dbScope(context), async (tx) => {
      const [created] = await tx
        .insert(regions)
        .values({ organizationId: context.organization.id, name: input.name, description: input.description ?? null })
        .returning({ id: regions.id });
      await recordAudit(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        action: "region.created",
        entityType: "region",
        entityId: created.id,
        changes: { name: input.name },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error, "regions_org_name_idx")) throw NAME_TAKEN();
    throw error;
  }
}

export async function updateRegion(context: TenantContext, regionId: string, input: RegionInput) {
  assertCan(context, "regions.manage");
  assertOrganizationWide(context);
  const orgId = context.organization.id;
  try {
    await withScope(dbScope(context), async (tx) => {
      const [current] = await tx
        .select({ name: regions.name, description: regions.description })
        .from(regions)
        .where(and(eq(regions.organizationId, orgId), eq(regions.id, regionId)));
      if (!current) throw notFound("Região não encontrada.");
      const next = { name: input.name, description: input.description ?? null };
      const changes = diffFields(current, next, ["name", "description"]);
      if (Object.keys(changes).length === 0) return;
      await tx
        .update(regions)
        .set({ ...next, updatedAt: new Date() })
        .where(and(eq(regions.organizationId, orgId), eq(regions.id, regionId)));
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "region.updated",
        entityType: "region",
        entityId: regionId,
        changes,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, "regions_org_name_idx")) throw NAME_TAKEN();
    throw error;
  }
}

/** Stores are detached; deletion is refused while members are scoped to the region. */
export async function deleteRegion(context: TenantContext, regionId: string) {
  assertCan(context, "regions.manage");
  assertOrganizationWide(context);
  const orgId = context.organization.id;
  try {
    await deleteRegionInScope(context, orgId, regionId);
  } catch (error) {
    // A member scope linked concurrently: the restrictive foreign key aborts the deletion.
    if (isForeignKeyViolation(error, "membership_regions_region_fk")) throw REGION_IN_USE();
    throw error;
  }
}

const REGION_IN_USE = (members?: number) =>
  invalid(
    `${members === undefined ? "Há membros com" : `${members} membro(s) têm`} acesso por esta região. Ajuste o escopo deles antes de excluí-la.`,
  );

async function deleteRegionInScope(context: TenantContext, orgId: string, regionId: string) {
  await withScope(dbScope(context), async (tx) => {
    const [current] = await tx
      .select({ name: regions.name })
      .from(regions)
      .where(and(eq(regions.organizationId, orgId), eq(regions.id, regionId)));
    if (!current) throw notFound("Região não encontrada.");
    const [linked] = await tx
      .select({ value: count() })
      .from(membershipRegions)
      .where(and(eq(membershipRegions.organizationId, orgId), eq(membershipRegions.regionId, regionId)));
    if (linked.value > 0) throw REGION_IN_USE(linked.value);
    const detached = await tx
      .update(stores)
      .set({ regionId: null, updatedAt: new Date() })
      .where(and(eq(stores.organizationId, orgId), eq(stores.regionId, regionId)))
      .returning({ id: stores.id });
    await tx.delete(regions).where(and(eq(regions.organizationId, orgId), eq(regions.id, regionId)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "region.deleted",
      entityType: "region",
      entityId: regionId,
      changes: { name: current.name, detachedStores: detached.length },
    });
    // Store-level entries keep the change visible to members scoped to those stores.
    for (const store of detached) {
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "store.updated",
        entityType: "store",
        entityId: store.id,
        storeId: store.id,
        changes: { regionId: { from: regionId, to: null }, reason: "region.deleted" },
      });
    }
  });
}

/** Confirms ids belong to the organization (used by store and member forms). */
export async function assertRegionsExist(tx: Tx, orgId: string, ids: string[]) {
  if (ids.length === 0) return;
  const found = await tx
    .select({ id: regions.id })
    .from(regions)
    .where(and(eq(regions.organizationId, orgId), inArray(regions.id, ids)));
  if (found.length !== new Set(ids).size) throw invalid("Região inválida.", { regionIds: ["Selecione regiões válidas."] });
}
