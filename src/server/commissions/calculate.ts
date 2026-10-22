import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { organizationMemberships, products, productVariants, saleItems, saleRefundItems, saleRefunds, sales, salespeople, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertStoreInScope, can } from "@/server/authz/guard";
import { invalid, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { assertFeature } from "@/server/plans/entitlements";
import { effectiveLineCents } from "@/server/sales/refund-schemas";
import { monthRange } from "@/server/targets/schemas";
import { campaignBonus } from "./campaign-schemas";
import { loadCampaigns } from "./campaigns";
import { loadRules } from "./rules";
import { commissionOf, rateFor, ruleInForce, statementKeySchema, type StatementKey } from "./schemas";

// Commission lines of a salesperson in a store and month (dates local to the
// store): sale items completed in the month, and reversals (cancellation and
// return items) registered in the month, at the rate of the original sale. A
// campaign bonus (m35a) of the sale day adds to the rule rate.

export interface CommissionLine {
  kind: "sale" | "refund";
  saleId: string;
  saleItemId: string;
  refundId: string | null;
  baseCents: number;
  rateBps: number;
  commissionCents: number;
  ruleId: string | null;
  campaignId: string | null;
  bonusRateBps: number;
}

export interface CommissionResult {
  baseCents: number;
  commissionCents: number;
  lines: CommissionLine[];
}

export function parseKey(input: unknown): StatementKey {
  const parsed = statementKeySchema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

const localDay = (context: TenantContext, timestamp: SQL | typeof sales.completedAt) =>
  sql<string>`to_char(((${timestamp}) at time zone coalesce(${stores.timezone}, ${context.organization.timezone}))::date, 'YYYY-MM-DD')`;

/** The salesperson's user (sales record the user), or not found. */
export async function salespersonUser(tx: Tx, organizationId: string, salespersonId: string) {
  const [row] = await tx
    .select({ userId: organizationMemberships.userId })
    .from(salespeople)
    .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, salespeople.organizationId), eq(organizationMemberships.id, salespeople.membershipId)))
    .where(and(eq(salespeople.organizationId, organizationId), eq(salespeople.id, salespersonId)));
  if (!row) throw notFound("Vendedor não encontrado.");
  return row.userId;
}

export async function computeLines(tx: Tx, context: TenantContext, key: StatementKey): Promise<CommissionResult> {
  const orgId = context.organization.id;
  const userId = await salespersonUser(tx, orgId, key.salespersonId);
  const { from, to } = monthRange(key.month);
  const rules = await loadRules(tx, orgId);
  // Reversals use the bonus of the original sale day, which may be before the month.
  const campaigns = await loadCampaigns(tx, orgId, key.storeId, "1900-01-01", to);
  const saleDay = localDay(context, sales.completedAt);
  const ofSalesperson = and(eq(sales.organizationId, orgId), eq(sales.storeId, key.storeId), eq(sales.salespersonUserId, userId));
  const storeJoin = and(eq(stores.organizationId, sales.organizationId), eq(stores.id, sales.storeId));
  const itemJoin = and(eq(productVariants.organizationId, saleItems.organizationId), eq(productVariants.id, saleItems.variantId));
  const productJoin = and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId));

  const sold = await tx
    .select({ saleId: sales.id, saleTotal: sales.totalCents, day: saleDay, itemId: saleItems.id, itemTotal: saleItems.totalCents, productId: products.id, categoryId: products.categoryId })
    .from(sales)
    .innerJoin(stores, storeJoin)
    .innerJoin(saleItems, and(eq(saleItems.organizationId, sales.organizationId), eq(saleItems.saleId, sales.id)))
    .innerJoin(productVariants, itemJoin)
    .innerJoin(products, productJoin)
    .where(and(ofSalesperson, inArray(sales.status, ["completed", "cancelled"]), sql`${saleDay} between ${from} and ${to}`));
  const reversed = await tx
    .select({ refundId: saleRefunds.id, saleId: sales.id, day: saleDay, itemId: saleRefundItems.saleItemId, amount: saleRefundItems.amountCents, productId: products.id, categoryId: products.categoryId })
    .from(saleRefundItems)
    .innerJoin(saleRefunds, and(eq(saleRefunds.organizationId, saleRefundItems.organizationId), eq(saleRefunds.id, saleRefundItems.refundId)))
    .innerJoin(sales, and(eq(sales.organizationId, saleRefunds.organizationId), eq(sales.id, saleRefunds.saleId)))
    .innerJoin(stores, storeJoin)
    .innerJoin(saleItems, and(eq(saleItems.organizationId, saleRefundItems.organizationId), eq(saleItems.id, saleRefundItems.saleItemId)))
    .innerJoin(productVariants, itemJoin)
    .innerJoin(products, productJoin)
    .where(and(ofSalesperson, sql`${localDay(context, sql`${saleRefunds.createdAt}`)} between ${from} and ${to}`));

  const netsBySale = new Map<string, number>();
  for (const row of sold) netsBySale.set(row.saleId, (netsBySale.get(row.saleId) ?? 0) + row.itemTotal);
  const line = (kind: CommissionLine["kind"], saleId: string, saleItemId: string, refundId: string | null, baseCents: number, day: string, productId: string, categoryId: string | null): CommissionLine => {
    const { ruleId, rateBps } = rateFor(ruleInForce(rules, key.storeId, day), categoryId);
    const { campaignId, bonusRateBps } = campaignBonus(campaigns, key.storeId, day, productId, categoryId);
    return { kind, saleId, saleItemId, refundId, baseCents, rateBps, commissionCents: commissionOf(baseCents, rateBps + bonusRateBps), ruleId, campaignId, bonusRateBps };
  };
  const lines = [
    ...sold.map((row) => line("sale", row.saleId, row.itemId, null, effectiveLineCents(row.itemTotal, netsBySale.get(row.saleId)!, row.saleTotal), row.day, row.productId, row.categoryId)),
    ...reversed.map((row) => line("refund", row.saleId, row.itemId, row.refundId, -row.amount, row.day, row.productId, row.categoryId)),
  ].filter((entry) => entry.baseCents !== 0);
  return {
    baseCents: lines.reduce((sum, entry) => sum + entry.baseCents, 0),
    commissionCents: lines.reduce((sum, entry) => sum + entry.commissionCents, 0),
    lines,
  };
}

/** Estimate without writing: commissions.read in the store scope, or the salesperson about themselves. */
export async function estimateCommission(context: TenantContext, rawKey: unknown): Promise<CommissionResult> {
  const key = parseKey(rawKey);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    if (can(context, "commissions.read")) assertStoreInScope(context, key.storeId);
    else if ((await salespersonUser(tx, orgId, key.salespersonId)) !== context.user.id) throw notFound("Vendedor não encontrado.");
    return computeLines(tx, context, key);
  });
}
