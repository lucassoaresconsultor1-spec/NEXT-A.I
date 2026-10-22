import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { alertRules, alerts, organizationMemberships, organizations } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, resolveMembershipStores, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide } from "@/server/authz/guard";
import { invalid, notFound } from "@/server/errors";
import { requiredText } from "@/server/forms";
import { pageResult, pageWindow, parsePage } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";
import { ALERT_KINDS, evaluateOrganization, NEEDS_THRESHOLD, type AlertKind } from "./rules";

// Alerts (m23a): rule settings (organization-wide), evaluation (manual or by the
// periodic trigger) and the human lifecycle open -> acknowledged -> resolved.

const ruleSchema = z.object({
  enabled: z.boolean(),
  severity: z.enum(["info", "warning", "critical"], { error: "Escolha a severidade." }),
  threshold: z.coerce.number().int().min(0).max(1_000_000_000_000).optional(),
});

export async function saveRule(context: TenantContext, kind: AlertKind, rawInput: unknown): Promise<void> {
  assertCan(context, "alerts.manage");
  assertOrganizationWide(context);
  if (!ALERT_KINDS.includes(kind)) throw notFound("Regra não encontrada.");
  const parsed = ruleSchema.safeParse(rawInput);
  if (!parsed.success) throw invalid("Revise os campos destacados.");
  const input = parsed.data;
  if (input.enabled && NEEDS_THRESHOLD[kind] && input.threshold === undefined) throw invalid("Revise os campos destacados.", { threshold: ["Informe o limite desta regra."] });
  const orgId = context.organization.id;
  const values = { isEnabled: input.enabled, severity: input.severity, threshold: input.threshold ?? null, updatedAt: new Date() };
  await withScope(dbScope(context), async (tx) => {
    await tx.insert(alertRules).values({ organizationId: orgId, kind, ...values }).onConflictDoUpdate({ target: [alertRules.organizationId, alertRules.kind], set: values });
    await recordAudit(tx, { organizationId: orgId, actorUserId: context.user.id, action: "alert_rule.saved", entityType: "alert", entityId: orgId, changes: { kind, ...input } });
  });
}

export async function listRules(context: TenantContext) {
  assertCan(context, "alerts.read");
  const saved = await withScope(dbScope(context), (tx) => tx.select().from(alertRules).where(eq(alertRules.organizationId, context.organization.id)));
  return ALERT_KINDS.map((kind) => {
    const rule = saved.find((entry) => entry.kind === kind);
    return { kind, needsThreshold: NEEDS_THRESHOLD[kind], enabled: rule?.isEnabled ?? false, severity: rule?.severity ?? "warning", threshold: rule?.threshold ?? null };
  });
}

export async function evaluateNow(context: TenantContext): Promise<{ raised: number }> {
  assertCan(context, "alerts.manage");
  return { raised: await evaluateOrganization(context.organization.id, context.organization.timezone) };
}

/** For the periodic trigger (production scheduler is a deployment pending item). */
export async function runAlertEvaluation(now = new Date()): Promise<{ raised: number }> {
  const orgs = await withScope({ platform: true }, (tx) => tx.select({ id: organizations.id, timezone: organizations.timezone }).from(organizations).where(eq(organizations.status, "active")));
  let raised = 0;
  for (const org of orgs) raised += await evaluateOrganization(org.id, org.timezone, now);
  return { raised };
}

const visible = (context: TenantContext) => storeScopeCondition(context.storeScope, alerts.storeId);

export async function listAlerts(context: TenantContext, filters: { status?: "open" | "acknowledged" | "resolved"; storeId?: string; page?: unknown } = {}) {
  assertCan(context, "alerts.read");
  const page = parsePage(filters.page);
  const where = and(
    eq(alerts.organizationId, context.organization.id),
    visible(context),
    filters.status ? eq(alerts.status, filters.status) : undefined,
    filters.storeId && isUuid(filters.storeId) ? eq(alerts.storeId, filters.storeId) : undefined,
  );
  const { limit, offset } = pageWindow(page);
  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(alerts).where(where);
    const rows = await tx.select().from(alerts).where(where).orderBy(desc(alerts.lastSeenAt)).limit(limit).offset(offset);
    return pageResult(rows, total.value, page);
  });
}

async function lockAlert(tx: Tx, context: TenantContext, alertId: string) {
  if (!isUuid(alertId)) throw notFound("Alerta não encontrado.");
  const [row] = await tx
    .select({ id: alerts.id, status: alerts.status, storeId: alerts.storeId })
    .from(alerts)
    .where(and(eq(alerts.organizationId, context.organization.id), eq(alerts.id, alertId), visible(context)))
    .for("update");
  if (!row) throw notFound("Alerta não encontrado.");
  if (row.status === "resolved") throw invalid("Este alerta já foi resolvido.");
  return row;
}

async function change(context: TenantContext, alertId: string, action: string, values: Partial<typeof alerts.$inferInsert>, changes: Record<string, unknown>, check?: (tx: Tx, row: { storeId: string | null }) => Promise<void>) {
  assertCan(context, "alerts.manage");
  await withScope(dbScope(context), async (tx) => {
    const row = await lockAlert(tx, context, alertId);
    await check?.(tx, row);
    await tx.update(alerts).set({ ...values, updatedAt: new Date() }).where(and(eq(alerts.organizationId, context.organization.id), eq(alerts.id, row.id)));
    await recordAudit(tx, { organizationId: context.organization.id, actorUserId: context.user.id, action: `alert.${action}`, entityType: "alert", entityId: row.id, storeId: row.storeId, changes });
  });
}

export const acknowledgeAlert = (context: TenantContext, alertId: string) => change(context, alertId, "acknowledged", { status: "acknowledged" }, {});

export async function assignAlert(context: TenantContext, alertId: string, membershipId: string) {
  await change(context, alertId, "assigned", { assignedMembershipId: membershipId }, { membershipId }, async (tx, row) => {
    if (!isUuid(membershipId)) throw notFound("Membro não encontrado.");
    const [member] = await tx
      .select({ id: organizationMemberships.id, storeAccess: organizationMemberships.storeAccess })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, context.organization.id), eq(organizationMemberships.id, membershipId), eq(organizationMemberships.status, "active")));
    if (!member) throw notFound("Membro não encontrado.");
    // The assignee must reach the alert's store.
    if (row.storeId && member.storeAccess !== "all" && !(await resolveMembershipStores(tx, context.organization.id, member.id)).includes(row.storeId)) {
      throw invalid("Este membro não tem acesso à loja do alerta.");
    }
  });
}

export async function resolveAlert(context: TenantContext, alertId: string, rawInput: unknown) {
  const parsed = z.object({ note: requiredText("a nota de resolução", 240, 3) }).safeParse(rawInput);
  if (!parsed.success) throw invalid("Revise os campos destacados.", { note: parsed.error.issues.map((issue) => issue.message) });
  await change(context, alertId, "resolved", { status: "resolved", resolvedAt: new Date(), resolvedBy: context.user.id, resolutionNote: parsed.data.note }, { note: parsed.data.note });
}

