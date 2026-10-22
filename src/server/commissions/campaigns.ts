import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { categories, commissionCampaignItems, commissionCampaigns, products, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide, assertStoreInScope } from "@/server/authz/guard";
import { invalid, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { pageResult, pageWindow } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";
import { todayIn } from "@/server/targets/schemas";
import type { z } from "zod";
import { campaignFiltersSchema, campaignInputSchema, endCampaignSchema, type CampaignFilters, type CampaignInput, type CampaignVersion } from "./campaign-schemas";

// Commission campaigns (m35a). Created from today on (organization's time zone),
// never edited; ending before the start cancels, after it the period ends today.
// The bonus enters estimateCommission and the statements through loadCampaigns.

const CAMPAIGN_NOT_FOUND = () => notFound("Campanha não encontrada.");

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

/** Campaigns of the organization or of a store in scope. */
function visibleCampaigns(context: TenantContext): SQL | undefined {
  const inScope = storeScopeCondition(context.storeScope, commissionCampaigns.storeId);
  return inScope ? or(isNull(commissionCampaigns.storeId), inScope) : undefined;
}

/** Campaigns (not cancelled) that may touch a store in the period, with their items, in the caller's transaction. */
export async function loadCampaigns(tx: Tx, organizationId: string, storeId: string, from: string, to: string): Promise<CampaignVersion[]> {
  const rows = await tx
    .select({ id: commissionCampaigns.id, storeId: commissionCampaigns.storeId, startsOn: commissionCampaigns.startsOn, endsOn: commissionCampaigns.endsOn, bonusRateBps: commissionCampaigns.bonusRateBps })
    .from(commissionCampaigns)
    .where(
      and(
        eq(commissionCampaigns.organizationId, organizationId),
        isNull(commissionCampaigns.cancelledAt),
        or(isNull(commissionCampaigns.storeId), eq(commissionCampaigns.storeId, storeId)),
        lte(commissionCampaigns.startsOn, to),
        gte(commissionCampaigns.endsOn, from),
      ),
    );
  if (rows.length === 0) return [];
  const items = await tx
    .select({ campaignId: commissionCampaignItems.campaignId, productId: commissionCampaignItems.productId, categoryId: commissionCampaignItems.categoryId })
    .from(commissionCampaignItems)
    .where(and(eq(commissionCampaignItems.organizationId, organizationId), inArray(commissionCampaignItems.campaignId, rows.map((row) => row.id))));
  return rows.map((row) => {
    const own = items.filter((item) => item.campaignId === row.id);
    return { ...row, productIds: new Set(own.flatMap((item) => (item.productId ? [item.productId] : []))), categoryIds: new Set(own.flatMap((item) => (item.categoryId ? [item.categoryId] : []))) };
  });
}

export async function createCampaign(context: TenantContext, rawInput: CampaignInput): Promise<{ id: string }> {
  assertCan(context, "commissions.manage");
  const input = parse(campaignInputSchema, rawInput);
  if (input.storeId) assertStoreInScope(context, input.storeId);
  else assertOrganizationWide(context);
  if (input.startsOn < todayIn(context.organization.timezone)) throw invalid("Revise os campos destacados.", { startsOn: ["A campanha começa hoje ou depois; não é possível retroagir."] });
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    if (input.storeId) {
      const [store] = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, input.storeId)));
      if (!store) throw notFound("Loja não encontrada.");
    }
    const exists = async (table: typeof products | typeof categories, values: string[]) =>
      values.length === 0 || (await tx.select({ value: count() }).from(table).where(and(eq(table.organizationId, orgId), inArray(table.id, values))))[0].value === values.length;
    if (!(await exists(products, input.productIds))) throw invalid("Revise os campos destacados.", { productIds: ["Produto não encontrado."] });
    if (!(await exists(categories, input.categoryIds))) throw invalid("Revise os campos destacados.", { categoryIds: ["Categoria não encontrada."] });
    const storeId = input.storeId ?? null;
    const [created] = await tx
      .insert(commissionCampaigns)
      .values({ organizationId: orgId, storeId, name: input.name, startsOn: input.startsOn, endsOn: input.endsOn, bonusRateBps: input.bonusRateBps, createdBy: context.user.id })
      .returning({ id: commissionCampaigns.id });
    await tx.insert(commissionCampaignItems).values([
      ...input.productIds.map((productId) => ({ organizationId: orgId, campaignId: created.id, productId })),
      ...input.categoryIds.map((categoryId) => ({ organizationId: orgId, campaignId: created.id, categoryId })),
    ]);
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "commission_campaign.created",
      entityType: "commission_campaign",
      entityId: created.id,
      storeId,
      changes: { name: input.name, startsOn: input.startsOn, endsOn: input.endsOn, bonusRateBps: input.bonusRateBps, productIds: input.productIds, categoryIds: input.categoryIds },
    });
    return { id: created.id };
  });
}

export async function endCampaign(context: TenantContext, campaignId: string, rawInput: unknown): Promise<{ status: "cancelled" | "ended" }> {
  assertCan(context, "commissions.manage");
  const { reason } = parse(endCampaignSchema, rawInput);
  if (!isUuid(campaignId)) throw CAMPAIGN_NOT_FOUND();
  const orgId = context.organization.id;
  const today = todayIn(context.organization.timezone);
  return withScope(dbScope(context), async (tx) => {
    const [row] = await tx
      .select({ id: commissionCampaigns.id, storeId: commissionCampaigns.storeId, startsOn: commissionCampaigns.startsOn, endsOn: commissionCampaigns.endsOn, cancelledAt: commissionCampaigns.cancelledAt })
      .from(commissionCampaigns)
      .where(and(eq(commissionCampaigns.organizationId, orgId), eq(commissionCampaigns.id, campaignId), visibleCampaigns(context)))
      .for("update");
    if (!row) throw CAMPAIGN_NOT_FOUND();
    if (row.storeId) assertStoreInScope(context, row.storeId);
    else assertOrganizationWide(context);
    if (row.cancelledAt || row.endsOn <= today) throw invalid("Esta campanha já terminou.");
    const now = new Date();
    const status = row.startsOn > today ? "cancelled" : "ended";
    await tx
      .update(commissionCampaigns)
      .set(status === "cancelled" ? { cancelledAt: now, endedBy: context.user.id, endReason: reason, updatedAt: now } : { endsOn: today, endedBy: context.user.id, endReason: reason, updatedAt: now })
      .where(and(eq(commissionCampaigns.organizationId, orgId), eq(commissionCampaigns.id, row.id)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: `commission_campaign.${status}`,
      entityType: "commission_campaign",
      entityId: row.id,
      storeId: row.storeId,
      changes: { reason, endsOn: status === "ended" ? today : row.endsOn },
    });
    return { status };
  });
}

const listColumns = {
  id: commissionCampaigns.id,
  storeId: commissionCampaigns.storeId,
  name: commissionCampaigns.name,
  startsOn: commissionCampaigns.startsOn,
  endsOn: commissionCampaigns.endsOn,
  bonusRateBps: commissionCampaigns.bonusRateBps,
  cancelledAt: commissionCampaigns.cancelledAt,
  endReason: commissionCampaigns.endReason,
  createdAt: commissionCampaigns.createdAt,
};

export async function listCampaigns(context: TenantContext, rawFilters: CampaignFilters) {
  assertCan(context, "commissions.read");
  const filters = campaignFiltersSchema.parse(rawFilters);
  const today = todayIn(context.organization.timezone);
  const live = isNull(commissionCampaigns.cancelledAt);
  const byStatus = {
    scheduled: and(live, sql`${commissionCampaigns.startsOn} > ${today}::date`),
    active: and(live, sql`${commissionCampaigns.startsOn} <= ${today}::date and ${commissionCampaigns.endsOn} >= ${today}::date`),
    ended: or(sql`${commissionCampaigns.cancelledAt} is not null`, sql`${commissionCampaigns.endsOn} < ${today}::date`),
  };
  const where = and(eq(commissionCampaigns.organizationId, context.organization.id), visibleCampaigns(context), filters.status ? byStatus[filters.status] : undefined);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(commissionCampaigns).where(where);
    const rows = await tx.select(listColumns).from(commissionCampaigns).where(where).orderBy(desc(commissionCampaigns.startsOn), asc(commissionCampaigns.id)).limit(limit).offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}

export async function getCampaign(context: TenantContext, campaignId: string) {
  assertCan(context, "commissions.read");
  if (!isUuid(campaignId)) throw CAMPAIGN_NOT_FOUND();
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const [row] = await tx.select(listColumns).from(commissionCampaigns).where(and(eq(commissionCampaigns.organizationId, orgId), eq(commissionCampaigns.id, campaignId), visibleCampaigns(context)));
    if (!row) throw CAMPAIGN_NOT_FOUND();
    const items = await tx
      .select({ productId: commissionCampaignItems.productId, productName: products.name, categoryId: commissionCampaignItems.categoryId, categoryName: categories.name })
      .from(commissionCampaignItems)
      .leftJoin(products, and(eq(products.organizationId, commissionCampaignItems.organizationId), eq(products.id, commissionCampaignItems.productId)))
      .leftJoin(categories, and(eq(categories.organizationId, commissionCampaignItems.organizationId), eq(categories.id, commissionCampaignItems.categoryId)))
      .where(and(eq(commissionCampaignItems.organizationId, orgId), eq(commissionCampaignItems.campaignId, row.id)));
    return { ...row, items };
  });
}
