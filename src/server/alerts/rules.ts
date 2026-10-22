import "server-only";
import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { alertRules, alerts, cashSessions, dailyClosings, inventoryBalances, organizationMemberships, products, productVariants, queueEntries, roles, stores, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { loadTenantContext } from "@/server/authz/context";
import { OWNER_ROLE_KEY } from "@/server/authz/system-roles";
import { targetProgress } from "@/server/targets/progress";
import { todayIn } from "@/server/targets/schemas";

// Deterministic alert rules (m23a). Each rule runs only when enabled with its
// threshold (none is invented), reads the organization's data and returns findings;
// findings are stored once per dedupe key while open. State rules (stock, goals)
// resolve themselves when the condition is gone.

export const ALERT_KINDS = ["low_stock", "cash_difference", "reconciliation_divergent", "queue_abandonment", "target_at_risk"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
/** Kinds whose threshold is required to run. */
export const NEEDS_THRESHOLD: Record<AlertKind, boolean> = { low_stock: true, cash_difference: true, reconciliation_divergent: false, queue_abandonment: true, target_at_risk: true };
const SELF_RESOLVING: AlertKind[] = ["low_stock", "target_at_risk"];
const MAX_FINDINGS = 500;

interface Finding {
  kind: AlertKind;
  dedupeKey: string;
  storeId: string | null;
  title: string;
  detail: string;
}

const qty = (milli: number) => (milli / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function lowStock(tx: Tx, orgId: string, threshold: number): Promise<Finding[]> {
  const rows = await tx
    .select({ storeId: stores.id, storeName: stores.name, variantId: productVariants.id, product: products.name, variant: productVariants.name, available: sql<string>`(${inventoryBalances.quantity} - ${inventoryBalances.reserved})::text` })
    .from(inventoryBalances)
    .innerJoin(stores, and(eq(stores.organizationId, inventoryBalances.organizationId), eq(stores.id, inventoryBalances.storeId)))
    .innerJoin(productVariants, and(eq(productVariants.organizationId, inventoryBalances.organizationId), eq(productVariants.id, inventoryBalances.variantId)))
    .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
    .where(and(eq(inventoryBalances.organizationId, orgId), eq(stores.status, "active"), eq(productVariants.isActive, true), eq(products.isActive, true), sql`(${inventoryBalances.quantity} - ${inventoryBalances.reserved}) * 1000 <= ${threshold}`))
    .limit(MAX_FINDINGS);
  return rows.map((row) => ({
    kind: "low_stock",
    dedupeKey: `low_stock:${row.storeId}:${row.variantId}`,
    storeId: row.storeId,
    title: `Estoque baixo: ${row.product} · ${row.variant}`.slice(0, 160),
    detail: `Disponível ${qty(Math.round(Number(row.available) * 1000))} em ${row.storeName} (limite ${qty(threshold)}).`.slice(0, 500),
  }));
}

async function cashDifference(tx: Tx, orgId: string, threshold: number, now: Date): Promise<Finding[]> {
  const rows = await tx
    .select({ id: cashSessions.id, storeId: cashSessions.storeId, storeName: stores.name, difference: cashSessions.differenceCents })
    .from(cashSessions)
    .innerJoin(stores, and(eq(stores.organizationId, cashSessions.organizationId), eq(stores.id, cashSessions.storeId)))
    .where(and(eq(cashSessions.organizationId, orgId), eq(cashSessions.status, "closed"), gte(cashSessions.closedAt, new Date(now.getTime() - 2 * 86_400_000)), sql`abs(${cashSessions.differenceCents}) >= ${threshold}`))
    .limit(MAX_FINDINGS);
  return rows.map((row) => ({ kind: "cash_difference", dedupeKey: `cash_difference:${row.id}`, storeId: row.storeId, title: `Diferença de caixa em ${row.storeName}`.slice(0, 160), detail: `Caixa fechado com diferença de ${money(row.difference ?? 0)}.` }));
}

async function reconciliation(tx: Tx, orgId: string, today: string): Promise<Finding[]> {
  const latest = await tx
    .selectDistinctOn([dailyClosings.storeId, dailyClosings.day], { storeId: dailyClosings.storeId, day: dailyClosings.day, reconciliation: dailyClosings.reconciliation, divergent: dailyClosings.divergentCount })
    .from(dailyClosings)
    .where(and(eq(dailyClosings.organizationId, orgId), sql`${dailyClosings.day} >= ${today}::date - 7`))
    .orderBy(dailyClosings.storeId, dailyClosings.day, sql`${dailyClosings.version} desc`);
  return latest
    .filter((row) => row.reconciliation === "divergent")
    .map((row) => ({ kind: "reconciliation_divergent", dedupeKey: `reconciliation:${row.storeId}:${row.day}`, storeId: row.storeId, title: `Conciliação com divergência em ${row.day}`, detail: `${row.divergent} pagamento(s) integrado(s) diferem do provedor.` }));
}

async function queueAbandonment(tx: Tx, orgId: string, threshold: number, today: string): Promise<Finding[]> {
  const rows = await tx
    .select({ storeId: queueEntries.storeId, day: queueEntries.day, count: sql<number>`count(*)`.mapWith(Number) })
    .from(queueEntries)
    .where(and(eq(queueEntries.organizationId, orgId), eq(queueEntries.status, "abandoned"), sql`${queueEntries.day}::date >= ${today}::date - 1`))
    .groupBy(queueEntries.storeId, queueEntries.day)
    .having(sql`count(*) >= ${threshold}`);
  return rows.map((row) => ({ kind: "queue_abandonment", dedupeKey: `queue_abandonment:${row.storeId}:${row.day}`, storeId: row.storeId, title: `Desistências na fila em ${row.day}`, detail: `${row.count} cliente(s) desistiram antes de ser atendidos (limite ${threshold}).` }));
}

/** Read-only context of an active owner, so rules can use the services' own formulas. */
async function ownerContext(orgId: string) {
  const [owner] = await withScope({ organizationId: orgId }, (tx) =>
    tx
      .select({ id: users.id, email: users.email, name: users.name })
      .from(organizationMemberships)
      .innerJoin(roles, and(eq(roles.organizationId, organizationMemberships.organizationId), eq(roles.id, organizationMemberships.roleId)))
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(and(eq(organizationMemberships.organizationId, orgId), eq(roles.key, OWNER_ROLE_KEY), eq(organizationMemberships.status, "active"), eq(users.status, "active")))
      .limit(1),
  );
  if (!owner) return null;
  return loadTenantContext({ id: "alerts", activeOrganizationId: orgId, activeStoreId: null, expiresAt: new Date(Date.now() + 60_000), user: { ...owner, isPlatformAdmin: false, mustChangePassword: false } }, orgId);
}

async function targetsAtRisk(orgId: string, percent: number, today: string): Promise<Finding[]> {
  const context = await ownerContext(orgId);
  if (!context) return [];
  const progress = await targetProgress(context, { month: today.slice(0, 7) });
  return progress
    .filter((row) => (row.scope === "store" || row.scope === "salesperson") && row.workingDaysElapsed >= 3 && row.projectionCents * 100 < row.targetCents * percent)
    .map((row) => ({
      kind: "target_at_risk",
      dedupeKey: `target:${row.scope}:${row.storeId}:${row.salespersonId ?? "-"}:${row.month}`,
      storeId: row.storeId,
      title: row.scope === "store" ? "Meta da loja em risco" : "Meta de vendedor em risco",
      detail: `Projeção ${money(row.projectionCents)} para a meta de ${money(row.targetCents)} (${row.percent}% realizado, limite ${percent}%).`,
    }));
}

/** Evaluates the enabled rules of one organization and stores the findings; returns how many alerts were raised. */
export async function evaluateOrganization(orgId: string, timeZone: string, now = new Date()): Promise<number> {
  const today = todayIn(timeZone, now);
  const rules = await withScope({ organizationId: orgId }, (tx) => tx.select().from(alertRules).where(and(eq(alertRules.organizationId, orgId), eq(alertRules.isEnabled, true))));
  let raised = 0;
  for (const rule of rules) {
    if (NEEDS_THRESHOLD[rule.kind] && rule.threshold === null) continue;
    const threshold = rule.threshold ?? 0;
    const findings =
      rule.kind === "target_at_risk"
        ? await targetsAtRisk(orgId, threshold, today)
        : await withScope({ organizationId: orgId }, (tx) =>
            rule.kind === "low_stock" ? lowStock(tx, orgId, threshold) : rule.kind === "cash_difference" ? cashDifference(tx, orgId, threshold, now) : rule.kind === "queue_abandonment" ? queueAbandonment(tx, orgId, threshold, today) : reconciliation(tx, orgId, today),
          );
    await withScope({ organizationId: orgId }, async (tx) => {
      // Event alerts happen once: a key already handled (even resolved) is not raised again.
      const handled = SELF_RESOLVING.includes(rule.kind) || findings.length === 0
        ? new Set<string>()
        : new Set((await tx.select({ key: alerts.dedupeKey }).from(alerts).where(and(eq(alerts.organizationId, orgId), eq(alerts.kind, rule.kind), eq(alerts.status, "resolved"), inArray(alerts.dedupeKey, findings.map((finding) => finding.dedupeKey))))).map((row) => row.key));
      for (const finding of findings) {
        if (handled.has(finding.dedupeKey)) continue;
        const [row] = await tx
          .insert(alerts)
          .values({ organizationId: orgId, ...finding, severity: rule.severity })
          .onConflictDoUpdate({ target: [alerts.organizationId, alerts.dedupeKey], targetWhere: sql`${alerts.status} <> 'resolved'`, set: { lastSeenAt: now, detail: finding.detail } })
          .returning({ id: alerts.id, inserted: sql<boolean>`xmax = 0` });
        if (row.inserted) {
          raised += 1;
          await recordAudit(tx, { organizationId: orgId, actorUserId: null, action: "alert.raised", entityType: "alert", entityId: row.id, storeId: finding.storeId, changes: { kind: finding.kind, title: finding.title } });
        }
      }
      if (SELF_RESOLVING.includes(rule.kind)) {
        const keys = findings.map((finding) => finding.dedupeKey);
        const cleared = await tx
          .update(alerts)
          .set({ status: "resolved", resolvedAt: now, resolutionNote: "Resolvido automaticamente: a condição deixou de ocorrer.", updatedAt: now })
          .where(and(eq(alerts.organizationId, orgId), eq(alerts.kind, rule.kind), inArray(alerts.status, ["open", "acknowledged"]), keys.length ? notInArray(alerts.dedupeKey, keys) : undefined))
          .returning({ id: alerts.id, storeId: alerts.storeId });
        for (const alert of cleared) {
          await recordAudit(tx, { organizationId: orgId, actorUserId: null, action: "alert.resolved", entityType: "alert", entityId: alert.id, storeId: alert.storeId, changes: { automatic: true } });
        }
      }
    });
  }
  return raised;
}
