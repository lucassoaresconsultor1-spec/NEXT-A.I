import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { salespeople, salespersonStores, workSchedules } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { countBusinessDays, MAX_EXTRA_HOLIDAYS, type CalendarDay } from "@/lib/business-days";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope } from "@/server/authz/guard";
import { loadCalendarOptions } from "@/server/calendar/service";
import { invalid, notFound } from "@/server/errors";
import { scheduleSchema } from "./schemas";
import { parse, visibleSalespeople } from "./service";

// Monthly schedules (days off) of a salesperson in a store, and the working days
// used by goals (m11a): business days of the store (m01 + m32a) minus days off.

export async function setSchedule(context: TenantContext, rawInput: unknown): Promise<void> {
  assertCan(context, "salespeople.manage");
  const input = parse(scheduleSchema, rawInput);
  assertStoreInScope(context, input.storeId);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const [link] = await tx
      .select({ id: salespeople.id, code: salespeople.code })
      .from(salespeople)
      .innerJoin(
        salespersonStores,
        and(eq(salespersonStores.organizationId, salespeople.organizationId), eq(salespersonStores.salespersonId, salespeople.id), eq(salespersonStores.storeId, input.storeId)),
      )
      .where(and(eq(salespeople.organizationId, orgId), eq(salespeople.id, input.salespersonId), visibleSalespeople(context)));
    if (!link) throw notFound("Vendedor não encontrado nesta loja.");
    await tx
      .insert(workSchedules)
      .values({ organizationId: orgId, salespersonId: input.salespersonId, storeId: input.storeId, month: input.month, daysOff: input.daysOff })
      .onConflictDoUpdate({
        target: [workSchedules.organizationId, workSchedules.salespersonId, workSchedules.storeId, workSchedules.month],
        set: { daysOff: input.daysOff, updatedAt: new Date() },
      });
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "work_schedule.set",
      entityType: "salesperson",
      entityId: input.salespersonId,
      storeId: input.storeId,
      changes: { code: link.code, month: input.month, daysOff: input.daysOff },
    });
  });
}

function monthsBetween(from: CalendarDay, to: CalendarDay) {
  const months: string[] = [];
  let [year, month] = from.slice(0, 7).split("-").map(Number);
  const last = to.slice(0, 7);
  for (let guard = 0; guard < 1200; guard += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key >= last) break;
    month += 1;
    if (month > 12) [year, month] = [year + 1, 1];
  }
  return months;
}

/** Days the salesperson works in the store in [from, to]: business days of the store minus the days off. */
export async function workingDays(tx: Tx, organizationId: string, salespersonId: string, storeId: string, from: CalendarDay, to: CalendarDay): Promise<number> {
  const options = await loadCalendarOptions(tx, organizationId, storeId, from, to);
  const schedules = await tx
    .select({ daysOff: workSchedules.daysOff })
    .from(workSchedules)
    .where(and(eq(workSchedules.organizationId, organizationId), eq(workSchedules.salespersonId, salespersonId), eq(workSchedules.storeId, storeId), inArray(workSchedules.month, monthsBetween(from, to))));
  const extra = [...new Set([...(options.extraHolidays ?? []), ...schedules.flatMap((row) => row.daysOff)])];
  if (extra.length > MAX_EXTRA_HOLIDAYS) throw invalid("Período com folgas e feriados demais. Escolha um período menor.");
  return countBusinessDays(from, to, { ...options, extraHolidays: extra });
}
