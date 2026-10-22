import "server-only";
import { and, asc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { organizationMemberships, organizations, reportRuns, reportSchedules, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, loadTenantContext, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope } from "@/server/authz/guard";
import { invalid, isDomainError, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { logger } from "@/lib/logger";
import { isUuid } from "@/server/stores/schemas";
import { monthRange, todayIn } from "@/server/targets/schemas";
import { REPORT_KINDS } from "./catalog";
import { runReport } from "./service";

// Report schedules (m18): run as their owner with the owner's current permissions;
// the periodic trigger calls runDueSchedules (production cron is a pending item of
// the deployment). E-mail delivery stays "pending" until a provider exists.

const PERIODS = ["yesterday", "last_7_days", "month_to_date", "last_month"] as const;
const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
type Frequency = (typeof FREQUENCIES)[number];
type Period = (typeof PERIODS)[number];
const BATCH = 20;

const scheduleSchema = z.object({
  kind: z.enum(REPORT_KINDS, { error: "Escolha o relatório." }),
  period: z.enum(PERIODS, { error: "Escolha o período." }),
  frequency: z.enum(FREQUENCIES, { error: "Escolha a frequência." }),
  hour: z.coerce.number().int().min(0).max(23, { error: "Escolha uma hora entre 0 e 23." }),
  storeId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid({ error: "Loja inválida." }).optional()),
  groupBy: z.enum(["day", "week", "month"]).optional(),
});

const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** UTC instant of a local day and hour in a time zone. */
function zonedInstant(day: string, hour: number, timeZone: string) {
  const guess = Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(guess)).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  const offsetMinutes = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  return new Date(guess - offsetMinutes * 60_000);
}

/** Next run strictly after `now`: every day, every Monday or every 1st, at the local hour. */
export function nextRunAt(now: Date, frequency: Frequency, hour: number, timeZone: string) {
  let day = todayIn(timeZone, now);
  for (let guard = 0; guard < 400; guard += 1) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const matches = frequency === "daily" || (frequency === "weekly" && weekday === 1) || (frequency === "monthly" && day.endsWith("-01"));
    const instant = zonedInstant(day, hour, timeZone);
    if (matches && instant > now) return instant;
    day = shiftDay(day, 1);
  }
  throw new Error("No next run found");
}

/** Dates of a relative period on the local day of `now`. */
export function resolvePeriod(period: Period, now: Date, timeZone: string) {
  const today = todayIn(timeZone, now);
  if (period === "yesterday") return { from: shiftDay(today, -1), to: shiftDay(today, -1) };
  if (period === "last_7_days") return { from: shiftDay(today, -7), to: shiftDay(today, -1) };
  if (period === "month_to_date") return { from: `${today.slice(0, 7)}-01`, to: today };
  return monthRange(shiftDay(`${today.slice(0, 7)}-01`, -1).slice(0, 7));
}

export async function saveSchedule(context: TenantContext, rawInput: unknown, scheduleId?: string): Promise<{ id: string }> {
  assertCan(context, "reports.schedule");
  const parsed = scheduleSchema.safeParse(rawInput);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  const input = parsed.data;
  if (input.storeId) assertStoreInScope(context, input.storeId);
  const orgId = context.organization.id;
  const values = { ...input, storeId: input.storeId ?? null, groupBy: input.groupBy ?? null, nextRunAt: nextRunAt(new Date(), input.frequency, input.hour, context.organization.timezone), updatedAt: new Date() };
  return withScope(dbScope(context), async (tx) => {
    let id = scheduleId;
    if (id === undefined) {
      [{ id }] = await tx.insert(reportSchedules).values({ organizationId: orgId, ownerMembershipId: context.membershipId, ...values }).returning({ id: reportSchedules.id });
    } else {
      if (!isUuid(id)) throw notFound("Agendamento não encontrado.");
      const [updated] = await tx
        .update(reportSchedules)
        .set(values)
        .where(and(eq(reportSchedules.organizationId, orgId), eq(reportSchedules.id, id), eq(reportSchedules.ownerMembershipId, context.membershipId)))
        .returning({ id: reportSchedules.id });
      if (!updated) throw notFound("Agendamento não encontrado.");
    }
    await recordAudit(tx, { organizationId: orgId, actorUserId: context.user.id, action: "report_schedule.saved", entityType: "report", entityId: id!, storeId: input.storeId ?? null, changes: input });
    return { id: id! };
  });
}

export async function setScheduleActive(context: TenantContext, scheduleId: string, isActive: boolean): Promise<void> {
  assertCan(context, "reports.schedule");
  if (!isUuid(scheduleId)) throw notFound("Agendamento não encontrado.");
  await withScope(dbScope(context), async (tx) => {
    const [updated] = await tx
      .update(reportSchedules)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(reportSchedules.organizationId, context.organization.id), eq(reportSchedules.id, scheduleId), eq(reportSchedules.ownerMembershipId, context.membershipId)))
      .returning({ id: reportSchedules.id });
    if (!updated) throw notFound("Agendamento não encontrado.");
    await recordAudit(tx, { organizationId: context.organization.id, actorUserId: context.user.id, action: "report_schedule.status_changed", entityType: "report", entityId: scheduleId, changes: { isActive } });
  });
}

export async function listSchedules(context: TenantContext) {
  assertCan(context, "reports.schedule");
  return withScope(dbScope(context), (tx) =>
    tx
      .select()
      .from(reportSchedules)
      .where(and(eq(reportSchedules.organizationId, context.organization.id), eq(reportSchedules.ownerMembershipId, context.membershipId)))
      .orderBy(asc(reportSchedules.createdAt)),
  );
}

/**
 * For the periodic trigger: claims due schedules (moving next_run_at first, so a
 * concurrent trigger does not run them twice), then generates each report as its
 * owner. A failure is recorded as a failed run without data.
 */
export async function runDueSchedules(now = new Date()): Promise<{ ran: number; failed: number }> {
  const orgs = await withScope({ platform: true }, (tx) => tx.select({ id: organizations.id, timezone: organizations.timezone }).from(organizations).where(eq(organizations.status, "active")));
  let ran = 0;
  let failed = 0;
  for (const org of orgs) {
    const claimed = await withScope({ organizationId: org.id }, async (tx) => {
      const due = await tx
        .select({ id: reportSchedules.id, kind: reportSchedules.kind, period: reportSchedules.period, frequency: reportSchedules.frequency, hour: reportSchedules.hour, storeId: reportSchedules.storeId, groupBy: reportSchedules.groupBy, owner: reportSchedules.ownerMembershipId })
        .from(reportSchedules)
        .where(and(eq(reportSchedules.organizationId, org.id), eq(reportSchedules.isActive, true), lte(reportSchedules.nextRunAt, now)))
        .orderBy(asc(reportSchedules.nextRunAt))
        .limit(BATCH)
        .for("update", { skipLocked: true });
      for (const schedule of due) {
        await tx.update(reportSchedules).set({ nextRunAt: nextRunAt(now, schedule.frequency, schedule.hour, org.timezone), lastRunAt: now }).where(and(eq(reportSchedules.organizationId, org.id), eq(reportSchedules.id, schedule.id)));
      }
      return due;
    });
    for (const schedule of claimed) {
      const period = resolvePeriod(schedule.period, now, org.timezone);
      const params = { kind: schedule.kind, ...period, storeId: schedule.storeId ?? undefined, groupBy: schedule.groupBy ?? undefined };
      try {
        const [owner] = await withScope({ organizationId: org.id }, (tx) =>
          tx
            .select({ id: users.id, email: users.email, name: users.name })
            .from(organizationMemberships)
            .innerJoin(users, eq(users.id, organizationMemberships.userId))
            .where(and(eq(organizationMemberships.organizationId, org.id), eq(organizationMemberships.id, schedule.owner), eq(users.status, "active"))),
        );
        const context = owner
          ? await loadTenantContext({ id: `schedule:${schedule.id}`, activeOrganizationId: org.id, activeStoreId: null, expiresAt: new Date(now.getTime() + 60_000), user: { ...owner, isPlatformAdmin: false, mustChangePassword: false } }, org.id)
          : null;
        if (!context) throw invalid("O dono do agendamento não está mais ativo na empresa.");
        await runReport(context, params, schedule.id);
        ran += 1;
      } catch (error) {
        failed += 1;
        const reason = isDomainError(error) ? error.message : "Falha inesperada ao gerar o relatório.";
        if (!isDomainError(error)) logger.error({ scheduleId: schedule.id, err: { name: (error as Error)?.name } }, "Scheduled report failed");
        await withScope({ organizationId: org.id }, (tx) =>
          tx.insert(reportRuns).values({ organizationId: org.id, kind: params.kind, fromDate: params.from, toDate: params.to, storeId: params.storeId ?? null, groupBy: params.groupBy ?? null, status: "failed", rowCount: 0, failureReason: reason.slice(0, 240), scheduleId: schedule.id }),
        );
      }
    }
  }
  return { ran, failed };
}
