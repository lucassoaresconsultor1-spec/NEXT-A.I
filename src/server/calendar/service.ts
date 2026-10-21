import "server-only";
import { and, asc, between, eq, isNull, or } from "drizzle-orm";
import { calendarHolidays, stores, storeWorkWeeks } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { MAX_EXTRA_HOLIDAYS, type CalendarDay, type CalendarOptions } from "@/lib/business-days";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide, assertStoreInScope } from "@/server/authz/guard";
import { conflict, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { isUuid } from "@/server/stores/schemas";
import type { z } from "zod";
import { holidayFiltersSchema, holidaySchema, workWeekSchema, type HolidayFilters } from "./schemas";

// Company calendar (m32a): holidays of the organization (every store) or of one
// store, and each store's working weekdays. loadCalendarOptions turns them into
// the m01 options for schedules (m10a) and goals (m11a).

const HOLIDAY_NOT_FOUND = () => notFound("Feriado não encontrado.");
const DAY_TAKEN = () => conflict("Já existe um feriado nesta data.", { day: ["Já existe um feriado nesta data."] });

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

/** Organization-wide days need access to every store; store days need the store in scope. */
function assertTarget(context: TenantContext, storeId: string | null) {
  if (storeId) assertStoreInScope(context, storeId);
  else assertOrganizationWide(context);
}

async function assertStore(tx: Tx, organizationId: string, storeId: string) {
  const [store] = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, organizationId), eq(stores.id, storeId)));
  if (!store) throw notFound("Loja não encontrada.");
}

async function audit(tx: Tx, context: TenantContext, action: string, entityId: string, storeId: string | null, changes: Record<string, unknown>) {
  await recordAudit(tx, { organizationId: context.organization.id, actorUserId: context.user.id, action: `calendar.${action}`, entityType: "calendar", entityId, storeId, changes });
}

export async function listHolidays(context: TenantContext, filters: HolidayFilters) {
  assertCan(context, "organization.settings.read");
  const { year, storeId } = holidayFiltersSchema.parse(filters);
  const orgId = context.organization.id;
  if (storeId) assertStoreInScope(context, storeId);
  // Organization-wide days plus the store's (or every store in scope when no store is given).
  const storeCondition = storeId ? eq(calendarHolidays.storeId, storeId) : storeScopeCondition(context.storeScope, calendarHolidays.storeId);
  return withScope(dbScope(context), (tx) =>
    tx
      .select({ id: calendarHolidays.id, day: calendarHolidays.day, name: calendarHolidays.name, kind: calendarHolidays.kind, closed: calendarHolidays.closed, storeId: calendarHolidays.storeId })
      .from(calendarHolidays)
      .where(
        and(
          eq(calendarHolidays.organizationId, orgId),
          between(calendarHolidays.day, `${year}-01-01`, `${year}-12-31`),
          storeCondition ? or(isNull(calendarHolidays.storeId), storeCondition) : undefined,
        ),
      )
      .orderBy(asc(calendarHolidays.day)),
  );
}

export async function saveHoliday(context: TenantContext, rawInput: unknown, holidayId?: string): Promise<{ id: string }> {
  assertCan(context, "settings.operations.manage");
  const input = parse(holidaySchema, rawInput);
  assertTarget(context, input.storeId);
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      if (input.storeId) await assertStore(tx, orgId, input.storeId);
      const values = { day: input.day, name: input.name, kind: input.kind, closed: input.closed, storeId: input.storeId };
      if (holidayId === undefined) {
        const [created] = await tx.insert(calendarHolidays).values({ organizationId: orgId, ...values }).returning({ id: calendarHolidays.id });
        await audit(tx, context, "holiday_saved", created.id, input.storeId, values);
        return { id: created.id };
      }
      if (!isUuid(holidayId)) throw HOLIDAY_NOT_FOUND();
      const [current] = await tx
        .select({ storeId: calendarHolidays.storeId })
        .from(calendarHolidays)
        .where(and(eq(calendarHolidays.organizationId, orgId), eq(calendarHolidays.id, holidayId)))
        .for("update");
      if (!current) throw HOLIDAY_NOT_FOUND();
      assertTarget(context, current.storeId);
      await tx.update(calendarHolidays).set({ ...values, updatedAt: new Date() }).where(and(eq(calendarHolidays.organizationId, orgId), eq(calendarHolidays.id, holidayId)));
      await audit(tx, context, "holiday_saved", holidayId, input.storeId, values);
      return { id: holidayId };
    });
  } catch (error) {
    if (isUniqueViolation(error, "calendar_holidays_org_day_key") || isUniqueViolation(error, "calendar_holidays_store_day_key")) throw DAY_TAKEN();
    throw error;
  }
}

/** Configuration data: deleted for real, with an audit entry. */
export async function deleteHoliday(context: TenantContext, holidayId: string): Promise<void> {
  assertCan(context, "settings.operations.manage");
  if (!isUuid(holidayId)) throw HOLIDAY_NOT_FOUND();
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const [deleted] = await tx
      .delete(calendarHolidays)
      .where(and(eq(calendarHolidays.organizationId, orgId), eq(calendarHolidays.id, holidayId)))
      .returning({ storeId: calendarHolidays.storeId, day: calendarHolidays.day, name: calendarHolidays.name });
    if (!deleted) throw HOLIDAY_NOT_FOUND();
    // Out of reach: the delete is undone with the transaction.
    assertTarget(context, deleted.storeId);
    await audit(tx, context, "holiday_deleted", holidayId, deleted.storeId, { day: deleted.day, name: deleted.name });
  });
}

export async function getStoreWorkWeek(context: TenantContext, storeId: string): Promise<number[] | null> {
  assertCan(context, "organization.settings.read");
  if (!isUuid(storeId)) return null;
  assertStoreInScope(context, storeId);
  const [row] = await withScope(dbScope(context), (tx) =>
    tx.select({ weekdays: storeWorkWeeks.weekdays }).from(storeWorkWeeks).where(and(eq(storeWorkWeeks.organizationId, context.organization.id), eq(storeWorkWeeks.storeId, storeId))),
  );
  return row?.weekdays ?? null;
}

export async function setStoreWorkWeek(context: TenantContext, storeId: string, rawInput: unknown): Promise<void> {
  assertCan(context, "settings.operations.manage");
  if (!isUuid(storeId)) throw notFound("Loja não encontrada.");
  assertStoreInScope(context, storeId);
  const { weekdays } = parse(workWeekSchema, rawInput);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    await assertStore(tx, orgId, storeId);
    await tx
      .insert(storeWorkWeeks)
      .values({ organizationId: orgId, storeId, weekdays })
      .onConflictDoUpdate({ target: [storeWorkWeeks.organizationId, storeWorkWeeks.storeId], set: { weekdays, updatedAt: new Date() } });
    await audit(tx, context, "work_week_set", storeId, storeId, { weekdays });
  });
}

/** m01 options of a store for [from, to]: its own and organization-wide closed days, and its working weekdays. */
export async function loadCalendarOptions(tx: Tx, organizationId: string, storeId: string, from: CalendarDay, to: CalendarDay): Promise<CalendarOptions> {
  const days = await tx
    .selectDistinct({ day: calendarHolidays.day })
    .from(calendarHolidays)
    .where(
      and(
        eq(calendarHolidays.organizationId, organizationId),
        or(isNull(calendarHolidays.storeId), eq(calendarHolidays.storeId, storeId)),
        between(calendarHolidays.day, from, to),
        eq(calendarHolidays.closed, true),
      ),
    )
    .orderBy(asc(calendarHolidays.day))
    .limit(MAX_EXTRA_HOLIDAYS + 1);
  if (days.length > MAX_EXTRA_HOLIDAYS) throw invalid("Período com feriados demais. Escolha um período menor.");
  const [week] = await tx.select({ weekdays: storeWorkWeeks.weekdays }).from(storeWorkWeeks).where(and(eq(storeWorkWeeks.organizationId, organizationId), eq(storeWorkWeeks.storeId, storeId)));
  return { extraHolidays: days.map((row) => row.day), ...(week ? { workingWeekdays: week.weekdays } : {}) };
}
