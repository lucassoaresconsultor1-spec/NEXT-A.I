import "server-only";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { aiUsageRecords, organizationMemberships, organizations, planFeatures, plans, stores } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { limitReached } from "@/server/errors";

// The only place that reads plan limits and features. Modules ask questions
// here instead of comparing plan keys, so commercial rules stay in one spot.

export type PlanLimit = "stores" | "members";

export async function getOrganizationPlan(tx: Tx, organizationId: string) {
  const [plan] = await tx
    .select({ key: plans.key, name: plans.name, description: plans.description, maxStores: plans.maxStores, maxMembers: plans.maxMembers })
    .from(organizations)
    .innerJoin(plans, eq(plans.key, organizations.planKey))
    .where(eq(organizations.id, organizationId));
  if (!plan) throw new Error("Organization plan not found");
  const features = await tx.select({ feature: planFeatures.feature }).from(planFeatures).where(eq(planFeatures.planKey, plan.key));
  return { ...plan, features: features.map((entry) => entry.feature) };
}

export async function countUsage(tx: Tx, organizationId: string) {
  const [activeStores] = await tx
    .select({ value: count() })
    .from(stores)
    .where(and(eq(stores.organizationId, organizationId), eq(stores.status, "active")));
  const [activeMembers] = await tx
    .select({ value: count() })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), ne(organizationMemberships.status, "suspended")));
  return { stores: activeStores.value, members: activeMembers.value };
}

const LIMIT_MESSAGES: Record<PlanLimit, (max: number) => string> = {
  stores: (max) => `O plano atual permite até ${max} loja(s) ativa(s). Fale com o suporte para alterar o plano.`,
  members: (max) => `O plano atual permite até ${max} membro(s) ativo(s). Fale com o suporte para alterar o plano.`,
};

/** Plan features checked by modules (keys seeded in plan_features by migration 0002). */
export type PlanFeature = "inventory" | "pos" | "ai_assistant";

const FEATURE_MESSAGES: Record<PlanFeature, string> = {
  inventory: "O plano atual não inclui o controle de estoque. Fale com o suporte para alterar o plano.",
  pos: "O plano atual não inclui o PDV e o caixa. Fale com o suporte para alterar o plano.",
  ai_assistant: "O plano atual não inclui o assistente de IA. Fale com o suporte para alterar o plano.",
};

export async function hasFeature(tx: Tx, organizationId: string, feature: PlanFeature) {
  const [found] = await tx
    .select({ feature: planFeatures.feature })
    .from(organizations)
    .innerJoin(planFeatures, and(eq(planFeatures.planKey, organizations.planKey), eq(planFeatures.feature, feature)))
    .where(eq(organizations.id, organizationId));
  return Boolean(found);
}

export async function assertFeature(tx: Tx, organizationId: string, feature: PlanFeature) {
  if (!(await hasFeature(tx, organizationId, feature))) throw limitReached(FEATURE_MESSAGES[feature]);
}

/** Throws when adding `adding` units would exceed the plan; NULL limits mean unlimited. */
export async function assertWithinLimit(tx: Tx, organizationId: string, limit: PlanLimit, adding = 1) {
  // Serializes concurrent creations in the same organization until commit.
  await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).for("update");
  const plan = await getOrganizationPlan(tx, organizationId);
  const max = limit === "stores" ? plan.maxStores : plan.maxMembers;
  if (max === null) return;
  const usage = await countUsage(tx, organizationId);
  if (usage[limit] + adding > max) throw limitReached(LIMIT_MESSAGES[limit](max));
}

/** AI consumption of the organization in the current calendar month (organization time zone), from ai_usage_records. */
export async function aiMonthUsage(tx: Tx, organizationId: string, timeZone: string, now = new Date()) {
  const month = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(now);
  const [row] = await tx
    .select({
      calls: count(),
      tokens: sql<number>`coalesce(sum(${aiUsageRecords.inputTokens} + ${aiUsageRecords.outputTokens}), 0)`.mapWith(Number),
      costMicros: sql<number>`coalesce(sum(${aiUsageRecords.costMicros}), 0)`.mapWith(Number),
      uncosted: sql<number>`count(*) filter (where ${aiUsageRecords.costMicros} is null)`.mapWith(Number),
    })
    .from(aiUsageRecords)
    .where(and(eq(aiUsageRecords.organizationId, organizationId), sql`to_char(${aiUsageRecords.createdAt} at time zone ${timeZone}, 'YYYY-MM') = ${month}`));
  return { month, calls: row.calls, tokens: row.tokens, costMicros: row.costMicros, costComplete: row.uncosted === 0 };
}

/** Refuses a new model call when the plan's monthly AI token limit (if configured) was reached. */
export async function assertAiQuota(tx: Tx, organizationId: string, timeZone: string) {
  const [plan] = await tx.select({ max: plans.maxAiTokensPerMonth }).from(organizations).innerJoin(plans, eq(plans.key, organizations.planKey)).where(eq(organizations.id, organizationId));
  if (plan?.max === null || plan?.max === undefined) return;
  const usage = await aiMonthUsage(tx, organizationId, timeZone);
  if (usage.tokens >= plan.max) throw limitReached("O limite mensal de uso do assistente de IA do plano foi atingido. Fale com o suporte para alterar o plano.");
}
