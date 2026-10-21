import "server-only";
import { and, count, eq, ne } from "drizzle-orm";
import { organizationMemberships, organizations, planFeatures, plans, stores } from "@/db/schema";
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
export type PlanFeature = "inventory" | "pos";

const FEATURE_MESSAGES: Record<PlanFeature, string> = {
  inventory: "O plano atual não inclui o controle de estoque. Fale com o suporte para alterar o plano.",
  pos: "O plano atual não inclui o PDV e o caixa. Fale com o suporte para alterar o plano.",
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
