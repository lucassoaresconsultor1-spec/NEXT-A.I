import "server-only";
import { and, eq } from "drizzle-orm";
import { organizationMemberships, salespeople, salespersonStores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { dbScope, isStoreInScope, type TenantContext } from "@/server/authz/context";
import { computeSalesMetrics } from "@/server/metrics/sales";
import { assertFeature } from "@/server/plans/entitlements";

// The salesperson's own view (m34): who "I" am as a salesperson comes only from the
// authenticated user, never from the request. The sales metrics count the sales
// recorded with me as salesperson, in the stores of my access (the general metrics
// filter a member without sales.read by the cash operator, not by the salesperson).

export interface OwnSalesperson {
  id: string;
  code: string;
  nickname: string;
  /** Stores I am linked to as a salesperson, within my access. */
  storeIds: string[];
}

async function loadOwn(tx: Tx, context: TenantContext): Promise<OwnSalesperson | null> {
  const orgId = context.organization.id;
  const [me] = await tx
    .select({ id: salespeople.id, code: salespeople.code, nickname: salespeople.nickname })
    .from(salespeople)
    .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, salespeople.organizationId), eq(organizationMemberships.id, salespeople.membershipId)))
    .where(and(eq(salespeople.organizationId, orgId), eq(organizationMemberships.userId, context.user.id), eq(salespeople.isActive, true)));
  if (!me) return null;
  const links = await tx
    .select({ storeId: salespersonStores.storeId })
    .from(salespersonStores)
    .where(and(eq(salespersonStores.organizationId, orgId), eq(salespersonStores.salespersonId, me.id)));
  return { ...me, storeIds: links.map((link) => link.storeId).filter((storeId) => isStoreInScope(context.storeScope, storeId)) };
}

/** My active salesperson record, or null when I am not a salesperson. */
export async function ownSalesperson(context: TenantContext): Promise<OwnSalesperson | null> {
  return withScope(dbScope(context), (tx) => loadOwn(tx, context));
}

/** My sales metrics in the period (local days of each store), in the stores of my access; null when I am not a salesperson. */
export async function ownSalesMetrics(context: TenantContext, period: { from: string; to: string }) {
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, context.organization.id, "pos");
    if (!(await loadOwn(tx, context))) return null;
    const storeIds = context.storeScope.all ? undefined : [...context.storeScope.storeIds];
    return computeSalesMetrics(tx, context, { ...period, storeIds, salespersonUserId: context.user.id });
  });
}
