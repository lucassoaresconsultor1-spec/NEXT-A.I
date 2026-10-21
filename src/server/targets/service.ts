import "server-only";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { organizationMemberships, regions, salespeople, salespersonStores, salesTargets, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, isStoreInScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide, assertStoreInScope, can } from "@/server/authz/guard";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { isUuid } from "@/server/stores/schemas";
import { targetFiltersSchema, targetInputSchema, todayIn, type ParsedTarget, type TargetFilters } from "./schemas";

// Sales goals (m11a): append-only versions per (scope, target, month); the
// current goal is the highest version. Goals of past months are read-only.
// Members without sales.read only see their own salesperson goals.

// A literal (not a parameter), so DISTINCT ON and ORDER BY see the same expressions.
const NONE = sql.raw("'00000000-0000-0000-0000-000000000000'");
const TARGET_NOT_FOUND = () => notFound("Meta não encontrada.");

const sameTarget = (target: Pick<ParsedTarget, "scope" | "regionId" | "storeId" | "salespersonId" | "month">) =>
  and(
    eq(salesTargets.scope, target.scope),
    sql`coalesce(${salesTargets.regionId}, ${salesTargets.storeId}, ${NONE}::uuid) = coalesce(${target.regionId}::uuid, ${target.storeId}::uuid, ${NONE}::uuid)`,
    sql`coalesce(${salesTargets.salespersonId}, ${NONE}::uuid) = coalesce(${target.salespersonId}::uuid, ${NONE}::uuid)`,
    eq(salesTargets.month, target.month),
  );

/** Goals the member may read. */
export function visibleTargets(context: TenantContext): SQL | undefined {
  if (!can(context, "sales.read")) {
    return sql`${salesTargets.scope} = 'salesperson' and ${salesTargets.salespersonId} in (select ${salespeople.id} from ${salespeople}
      inner join ${organizationMemberships} on ${organizationMemberships.organizationId} = ${salespeople.organizationId} and ${organizationMemberships.id} = ${salespeople.membershipId}
      where ${salespeople.organizationId} = ${context.organization.id} and ${organizationMemberships.userId} = ${context.user.id})`;
  }
  const inScope = storeScopeCondition(context.storeScope, salesTargets.storeId);
  if (!inScope) return undefined;
  const regionInScope = storeScopeCondition(context.storeScope, stores.id)!;
  return sql`(${salesTargets.scope} = 'organization'
    or (${salesTargets.scope} = 'region' and exists (select 1 from ${stores} where ${stores.organizationId} = ${salesTargets.organizationId} and ${stores.regionId} = ${salesTargets.regionId} and ${regionInScope}))
    or (${salesTargets.scope} in ('store', 'salesperson') and ${inScope}))`;
}

/** The actor may set goals only where they reach: the whole organization, a region whose stores are all in scope, a store, or a salesperson of a store. */
async function assertTargetReach(tx: Tx, context: TenantContext, target: ParsedTarget) {
  const orgId = context.organization.id;
  if (target.scope === "organization") return assertOrganizationWide(context);
  if (target.scope === "region") {
    const [region] = await tx.select({ id: regions.id }).from(regions).where(and(eq(regions.organizationId, orgId), eq(regions.id, target.regionId!)));
    if (!region) throw notFound("Região não encontrada.");
    const regionStores = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.regionId, region.id)));
    if (context.storeScope.all) return;
    if (regionStores.length === 0 || !regionStores.some((store) => isStoreInScope(context.storeScope, store.id))) throw notFound("Região não encontrada.");
    if (!regionStores.every((store) => isStoreInScope(context.storeScope, store.id))) throw forbidden("A região tem lojas fora do seu acesso.");
    return;
  }
  assertStoreInScope(context, target.storeId!);
  const [store] = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, target.storeId!)));
  if (!store) throw notFound("Loja não encontrada.");
  if (target.scope === "salesperson") {
    const [link] = await tx
      .select({ id: salespersonStores.salespersonId })
      .from(salespersonStores)
      .where(and(eq(salespersonStores.organizationId, orgId), eq(salespersonStores.salespersonId, target.salespersonId!), eq(salespersonStores.storeId, target.storeId!)));
    if (!link) throw notFound("Vendedor não encontrado nesta loja.");
  }
}

export async function setTarget(context: TenantContext, rawInput: unknown): Promise<{ id: string; version: number }> {
  assertCan(context, "targets.manage");
  const parsed = targetInputSchema.safeParse(rawInput);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  const target = parsed.data;
  if (target.month < todayIn(context.organization.timezone).slice(0, 7)) throw invalid("Este mês já terminou: a meta não pode mais mudar.");
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      await assertTargetReach(tx, context, target);
      const [previous] = await tx
        .select({ version: salesTargets.version, amountCents: salesTargets.amountCents })
        .from(salesTargets)
        .where(and(eq(salesTargets.organizationId, orgId), sameTarget(target)))
        .orderBy(desc(salesTargets.version))
        .limit(1);
      if (previous && !target.reason) throw invalid("Revise os campos destacados.", { reason: ["Informe o motivo da mudança da meta."] });
      const version = (previous?.version ?? 0) + 1;
      const [created] = await tx
        .insert(salesTargets)
        .values({
          organizationId: orgId,
          scope: target.scope,
          regionId: target.regionId,
          storeId: target.storeId,
          salespersonId: target.salespersonId,
          month: target.month,
          amountCents: target.amountCents,
          version,
          reason: target.reason ?? null,
          createdBy: context.user.id,
        })
        .returning({ id: salesTargets.id });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "target.set",
        entityType: "sales_target",
        entityId: created.id,
        storeId: target.storeId,
        changes: { scope: target.scope, regionId: target.regionId, salespersonId: target.salespersonId, month: target.month, version, amountCents: target.amountCents, previousCents: previous?.amountCents ?? null, reason: target.reason ?? null },
      });
      return { id: created.id, version };
    });
  } catch (error) {
    if (isUniqueViolation(error, "sales_targets_version_key")) throw conflict("A meta foi alterada ao mesmo tempo por outra pessoa. Tente de novo.");
    throw error;
  }
}

const columns = {
  id: salesTargets.id,
  scope: salesTargets.scope,
  regionId: salesTargets.regionId,
  storeId: salesTargets.storeId,
  salespersonId: salesTargets.salespersonId,
  month: salesTargets.month,
  amountCents: salesTargets.amountCents,
  version: salesTargets.version,
  reason: salesTargets.reason,
  createdAt: salesTargets.createdAt,
};

/** Current version of every goal visible to the member in the month. */
export async function loadCurrentTargets(tx: Tx, context: TenantContext, filters: TargetFilters) {
  const parsed = targetFiltersSchema.parse(filters);
  return tx
    .selectDistinctOn([salesTargets.scope, sql`coalesce(${salesTargets.regionId}, ${salesTargets.storeId}, ${NONE}::uuid)`, sql`coalesce(${salesTargets.salespersonId}, ${NONE}::uuid)`], columns)
    .from(salesTargets)
    .where(
      and(
        eq(salesTargets.organizationId, context.organization.id),
        eq(salesTargets.month, parsed.month),
        parsed.scope ? eq(salesTargets.scope, parsed.scope) : undefined,
        parsed.storeId ? eq(salesTargets.storeId, parsed.storeId) : undefined,
        visibleTargets(context),
      ),
    )
    .orderBy(salesTargets.scope, sql`coalesce(${salesTargets.regionId}, ${salesTargets.storeId}, ${NONE}::uuid)`, sql`coalesce(${salesTargets.salespersonId}, ${NONE}::uuid)`, desc(salesTargets.version))
    .limit(500);
}

export async function listTargets(context: TenantContext, filters: TargetFilters) {
  assertCan(context, "targets.read");
  return withScope(dbScope(context), (tx) => loadCurrentTargets(tx, context, filters));
}

/** Every version of the goal the id belongs to, oldest first, with the reasons. */
export async function targetHistory(context: TenantContext, targetId: string) {
  assertCan(context, "targets.read");
  if (!isUuid(targetId)) throw TARGET_NOT_FOUND();
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const [target] = await tx.select(columns).from(salesTargets).where(and(eq(salesTargets.organizationId, orgId), eq(salesTargets.id, targetId), visibleTargets(context)));
    if (!target) throw TARGET_NOT_FOUND();
    return tx.select(columns).from(salesTargets).where(and(eq(salesTargets.organizationId, orgId), sameTarget(target))).orderBy(asc(salesTargets.version));
  });
}

