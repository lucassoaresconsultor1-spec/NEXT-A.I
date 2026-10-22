import "server-only";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { aiUsageRecords, opsEvents, organizations } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { invalid } from "@/server/errors";
import { assertPlatformAdmin, platformScope } from "./service";

// Observability by organization (m25), for the platform administration: unexpected
// errors and slow transactions (ops_events) and AI usage and cost (ai_usage_records)
// in a period. External APM/error tracking needs a provider credential (pending).

export async function observabilitySummary(actorId: string, period: { from: string; to: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.from) || !/^\d{4}-\d{2}-\d{2}$/.test(period.to) || period.from > period.to) throw invalid("Período inválido.");
  const start = new Date(`${period.from}T00:00:00Z`);
  const end = new Date(Date.parse(`${period.to}T00:00:00Z`) + 86_400_000);
  const { orgs, events } = await withScope(platformScope(actorId), async (tx) => {
    await assertPlatformAdmin(tx, actorId);
    // Bounded: the 200 most recent organizations (enough for the current scale; paginate when it grows).
    const orgs = await tx.select({ id: organizations.id, name: organizations.name }).from(organizations).orderBy(desc(organizations.createdAt)).limit(200);
    const events = await tx
      .select({
        organizationId: opsEvents.organizationId,
        errors: sql<number>`count(*) filter (where ${opsEvents.kind} = 'error')`.mapWith(Number),
        slow: sql<number>`count(*) filter (where ${opsEvents.kind} = 'slow_transaction')`.mapWith(Number),
        maxDurationMs: sql<number>`coalesce(max(${opsEvents.durationMs}), 0)`.mapWith(Number),
      })
      .from(opsEvents)
      .where(and(gte(opsEvents.createdAt, start), lt(opsEvents.createdAt, end)))
      .groupBy(opsEvents.organizationId);
    return { orgs, events };
  });
  const rows = [];
  for (const org of orgs) {
    // AI usage is tenant data: read inside each organization's own scope.
    const [ai] = await withScope({ organizationId: org.id }, (tx) =>
      tx
        .select({
          calls: sql<number>`count(*)`.mapWith(Number),
          tokens: sql<number>`coalesce(sum(${aiUsageRecords.inputTokens} + ${aiUsageRecords.outputTokens}), 0)`.mapWith(Number),
          costMicros: sql<number>`coalesce(sum(${aiUsageRecords.costMicros}), 0)`.mapWith(Number),
          errors: sql<number>`count(*) filter (where ${aiUsageRecords.status} = 'error')`.mapWith(Number),
        })
        .from(aiUsageRecords)
        .where(and(eq(aiUsageRecords.organizationId, org.id), gte(aiUsageRecords.createdAt, start), lt(aiUsageRecords.createdAt, end))),
    );
    const event = events.find((entry) => entry.organizationId === org.id);
    rows.push({ organizationId: org.id, name: org.name, errors: event?.errors ?? 0, slowTransactions: event?.slow ?? 0, maxDurationMs: event?.maxDurationMs ?? 0, ai });
  }
  const withoutOrganization = events.find((entry) => entry.organizationId === null);
  return {
    organizations: rows.sort((a, b) => b.errors - a.errors || b.slowTransactions - a.slowTransactions),
    withoutOrganization: { errors: withoutOrganization?.errors ?? 0, slowTransactions: withoutOrganization?.slow ?? 0 },
  };
}
