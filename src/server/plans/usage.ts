import "server-only";
import { withScope } from "@/db/tenant";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { aiMonthUsage, countUsage, getOrganizationPlan } from "./entitlements";
import { plans } from "@/db/schema";
import { eq } from "drizzle-orm";

// Plan usage (m40): measured consumption against the plan's configured limits.
// A null limit means the plan has no limit configured (never an invented number).

export async function getPlanUsage(context: TenantContext) {
  assertCan(context, "organization.settings.read");
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const plan = await getOrganizationPlan(tx, orgId);
    const [limits] = await tx.select({ maxAiTokensPerMonth: plans.maxAiTokensPerMonth }).from(plans).where(eq(plans.key, plan.key));
    const usage = await countUsage(tx, orgId);
    const ai = await aiMonthUsage(tx, orgId, context.organization.timezone);
    return {
      plan: { key: plan.key, name: plan.name, features: plan.features },
      stores: { used: usage.stores, max: plan.maxStores },
      members: { used: usage.members, max: plan.maxMembers },
      ai: { month: ai.month, calls: ai.calls, tokens: ai.tokens, maxTokens: limits?.maxAiTokensPerMonth ?? null, costMicros: ai.costMicros, costComplete: ai.costComplete },
    };
  });
}
