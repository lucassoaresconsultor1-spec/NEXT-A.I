import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { organizationMemberships, queueEntries, sales, salespeople } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { forbidden, notFound } from "@/server/errors";
import { isUuid } from "@/server/stores/schemas";

// Sale link of an attendance (m13b): lists the sales that finishAttendance would
// accept, so the tablet can offer them without sales.read.

const ENTRY_NOT_FOUND = () => notFound("Atendimento não encontrado.");
/** Sales that can close an attendance: of its salesperson, in its store, completed after the arrival, not linked yet (newest first). */
export async function eligibleSales(context: TenantContext, entryId: string) {
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const [entry] = await tx
      .select({ storeId: queueEntries.storeId, status: queueEntries.status, arrivedAt: queueEntries.arrivedAt, salespersonId: queueEntries.salespersonId })
      .from(queueEntries)
      .where(and(eq(queueEntries.organizationId, orgId), eq(queueEntries.id, isUuid(entryId) ? entryId : "00000000-0000-0000-0000-000000000000"), storeScopeCondition(context.storeScope, queueEntries.storeId)));
    if (!entry || entry.status !== "in_service") throw ENTRY_NOT_FOUND();
    const [attendant] = await tx
      .select({ userId: organizationMemberships.userId })
      .from(salespeople)
      .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, salespeople.organizationId), eq(organizationMemberships.id, salespeople.membershipId)))
      .where(and(eq(salespeople.organizationId, orgId), eq(salespeople.id, entry.salespersonId!)));
    if (attendant.userId !== context.user.id && !can(context, "queue.operate")) throw forbidden();
    return tx
      .select({ saleId: sales.id, number: sales.number, totalCents: sales.totalCents, completedAt: sales.completedAt })
      .from(sales)
      .where(
        and(
          eq(sales.organizationId, orgId),
          eq(sales.storeId, entry.storeId),
          eq(sales.status, "completed"),
          eq(sales.salespersonUserId, attendant.userId),
          sql`${sales.completedAt} >= ${entry.arrivedAt}`,
          sql`not exists (select 1 from ${queueEntries} q where q.organization_id = ${sales.organizationId} and q.sale_id = ${sales.id})`,
        ),
      )
      .orderBy(sql`${sales.completedAt} desc`)
      .limit(20);
  });
}
