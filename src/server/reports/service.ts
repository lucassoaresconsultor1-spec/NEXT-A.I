import "server-only";
import { and, count, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { reportRuns, reportSchedules } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { toCsv } from "@/lib/csv";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope } from "@/server/authz/guard";
import { invalid } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { MAX_PERIOD_DAYS } from "@/server/metrics/filters";
import { pageResult, pageWindow, parsePage } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";
import { assertRowLimit, buildReport, REPORT_KINDS, type ReportParams } from "./catalog";

// Report generation and history (m18): the CSV is built from the services as the
// member, stored append-only, and visible only to who asked for it (or owns the
// schedule that generated it).

const day = z.iso.date({ error: "Informe uma data válida." });
export const reportParamsSchema = z
  .object({
    kind: z.enum(REPORT_KINDS, { error: "Escolha o relatório." }),
    from: day,
    to: day,
    storeId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid({ error: "Loja inválida." }).optional()),
    groupBy: z.enum(["day", "week", "month"]).optional(),
  })
  .superRefine((input, context) => {
    const span = (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000 + 1;
    if (span < 1) context.addIssue({ code: "custom", path: ["to"], message: "A data final não pode ser anterior à inicial." });
    else if (span > MAX_PERIOD_DAYS) context.addIssue({ code: "custom", path: ["to"], message: `Escolha um período de até ${MAX_PERIOD_DAYS} dias.` });
  });

export function parseParams(input: unknown): ReportParams {
  const parsed = reportParamsSchema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

/** Generates the CSV as the member and records it; errors propagate (the scheduler records them as failed runs). */
export async function runReport(context: TenantContext, rawParams: unknown, scheduleId: string | null = null): Promise<{ id: string; rowCount: number }> {
  assertCan(context, "reports.read");
  const params = parseParams(rawParams);
  if (params.storeId) assertStoreInScope(context, params.storeId);
  const report = await buildReport(context, params);
  assertRowLimit(report.rows);
  const content = toCsv(report.header, report.rows);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const [run] = await tx
      .insert(reportRuns)
      .values({
        organizationId: orgId,
        kind: params.kind,
        fromDate: params.from,
        toDate: params.to,
        storeId: params.storeId ?? null,
        groupBy: params.groupBy ?? null,
        status: "done",
        rowCount: report.rows.length,
        content,
        scheduleId,
        requestedBy: context.user.id,
      })
      .returning({ id: reportRuns.id });
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "report.generated",
      entityType: "report",
      entityId: run.id,
      storeId: params.storeId ?? null,
      changes: { kind: params.kind, from: params.from, to: params.to, rows: report.rows.length, scheduled: scheduleId !== null },
    });
    return { id: run.id, rowCount: report.rows.length };
  });
}

/** Runs the member asked for, or produced by schedules they own. */
const ownRuns = (context: TenantContext) =>
  and(
    eq(reportRuns.organizationId, context.organization.id),
    or(
      eq(reportRuns.requestedBy, context.user.id),
      sql`${reportRuns.scheduleId} in (select ${reportSchedules.id} from ${reportSchedules}
        where ${reportSchedules.organizationId} = ${context.organization.id} and ${reportSchedules.ownerMembershipId} = ${context.membershipId})`,
    ),
  );

export async function listRuns(context: TenantContext, filters: { page?: unknown } = {}) {
  assertCan(context, "reports.read");
  const page = parsePage(filters.page);
  const { limit, offset } = pageWindow(page);
  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(reportRuns).where(ownRuns(context));
    const rows = await tx
      .select({
        id: reportRuns.id,
        kind: reportRuns.kind,
        from: reportRuns.fromDate,
        to: reportRuns.toDate,
        storeId: reportRuns.storeId,
        status: reportRuns.status,
        rowCount: reportRuns.rowCount,
        failureReason: reportRuns.failureReason,
        scheduleId: reportRuns.scheduleId,
        createdAt: reportRuns.createdAt,
      })
      .from(reportRuns)
      .where(ownRuns(context))
      .orderBy(desc(reportRuns.createdAt))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, page);
  });
}

export async function getRunCsv(context: TenantContext, runId: string): Promise<{ fileName: string; content: string } | null> {
  assertCan(context, "reports.read");
  if (!isUuid(runId)) return null;
  const [run] = await withScope(dbScope(context), (tx) =>
    tx
      .select({ kind: reportRuns.kind, from: reportRuns.fromDate, to: reportRuns.toDate, content: reportRuns.content })
      .from(reportRuns)
      .where(and(ownRuns(context), eq(reportRuns.id, runId), eq(reportRuns.status, "done"))),
  );
  return run?.content ? { fileName: `relatorio-${run.kind}-${run.from}-a-${run.to}.csv`, content: run.content } : null;
}
