import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { categories, commissionRuleRates, commissionRules, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide, assertStoreInScope } from "@/server/authz/guard";
import { conflict, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { todayIn } from "@/server/targets/schemas";
import { ruleInputSchema, type RuleInput, type RuleVersion } from "./schemas";

// Versioned commission rules (append-only): a new version starts on a date of the
// current month or later, never retroactively. Store rules override the
// organization's for that store.

const NONE = sql.raw("'00000000-0000-0000-0000-000000000000'::uuid");

/** Every rule version of the organization with its category rates (small set, read in the caller's transaction). */
export async function loadRules(tx: Tx, organizationId: string): Promise<RuleVersion[]> {
  const rules = await tx
    .select({ id: commissionRules.id, storeId: commissionRules.storeId, version: commissionRules.version, effectiveFrom: commissionRules.effectiveFrom, defaultRateBps: commissionRules.defaultRateBps })
    .from(commissionRules)
    .where(eq(commissionRules.organizationId, organizationId));
  const rates = rules.length
    ? await tx
        .select({ ruleId: commissionRuleRates.ruleId, categoryId: commissionRuleRates.categoryId, rateBps: commissionRuleRates.rateBps })
        .from(commissionRuleRates)
        .where(and(eq(commissionRuleRates.organizationId, organizationId), inArray(commissionRuleRates.ruleId, rules.map((rule) => rule.id))))
    : [];
  return rules.map((rule) => ({ ...rule, rates: new Map(rates.filter((rate) => rate.ruleId === rule.id).map((rate) => [rate.categoryId, rate.rateBps])) }));
}

export async function createRule(context: TenantContext, rawInput: RuleInput): Promise<{ id: string; version: number }> {
  assertCan(context, "commissions.manage");
  const parsed = ruleInputSchema.safeParse(rawInput);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  const input = parsed.data;
  if (input.storeId) assertStoreInScope(context, input.storeId);
  else assertOrganizationWide(context);
  if (input.effectiveFrom < `${todayIn(context.organization.timezone).slice(0, 7)}-01`) {
    throw invalid("Revise os campos destacados.", { effectiveFrom: ["A regra vale a partir do mês atual; não é possível retroagir."] });
  }
  const orgId = context.organization.id;
  const storeId = input.storeId ?? null;
  try {
    return await withScope(dbScope(context), async (tx) => {
      if (storeId) {
        const [store] = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, storeId)));
        if (!store) throw notFound("Loja não encontrada.");
      }
      const categoryIds = input.categoryRates.map((entry) => entry.categoryId);
      if (categoryIds.length) {
        const [found] = await tx.select({ value: count() }).from(categories).where(and(eq(categories.organizationId, orgId), inArray(categories.id, categoryIds)));
        if (found.value !== categoryIds.length) throw invalid("Revise os campos destacados.", { categoryRates: ["Categoria não encontrada."] });
      }
      const [previous] = await tx
        .select({ version: commissionRules.version })
        .from(commissionRules)
        .where(and(eq(commissionRules.organizationId, orgId), sql`coalesce(${commissionRules.storeId}, ${NONE}) = coalesce(${storeId}::uuid, ${NONE})`))
        .orderBy(desc(commissionRules.version))
        .limit(1);
      if (previous && !input.reason) throw invalid("Revise os campos destacados.", { reason: ["Informe o motivo da nova versão da regra."] });
      const version = (previous?.version ?? 0) + 1;
      const [created] = await tx
        .insert(commissionRules)
        .values({ organizationId: orgId, storeId, version, effectiveFrom: input.effectiveFrom, defaultRateBps: input.defaultRateBps, reason: input.reason ?? null, createdBy: context.user.id })
        .returning({ id: commissionRules.id });
      if (input.categoryRates.length) {
        await tx.insert(commissionRuleRates).values(input.categoryRates.map((entry) => ({ organizationId: orgId, ruleId: created.id, categoryId: entry.categoryId, rateBps: entry.rateBps })));
      }
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "commission_rule.created",
        entityType: "commission_rule",
        entityId: created.id,
        storeId,
        changes: { version, effectiveFrom: input.effectiveFrom, defaultRateBps: input.defaultRateBps, categoryRates: input.categoryRates, reason: input.reason ?? null },
      });
      return { id: created.id, version };
    });
  } catch (error) {
    if (isUniqueViolation(error, "commission_rules_version_key")) throw conflict("A regra foi alterada ao mesmo tempo por outra pessoa. Tente de novo.");
    throw error;
  }
}

/** Organization rules and the rules of stores in scope (optionally of one store), newest first. */
export async function listRules(context: TenantContext, filters: { storeId?: string } = {}) {
  assertCan(context, "commissions.read");
  const orgId = context.organization.id;
  const inScope = storeScopeCondition(context.storeScope, commissionRules.storeId);
  return withScope(dbScope(context), async (tx) => {
    const rules = await loadRules(tx, orgId);
    const visible = await tx
      .select({ id: commissionRules.id })
      .from(commissionRules)
      .where(
        and(
          eq(commissionRules.organizationId, orgId),
          filters.storeId ? or(isNull(commissionRules.storeId), eq(commissionRules.storeId, filters.storeId)) : undefined,
          inScope ? or(isNull(commissionRules.storeId), inScope) : undefined,
        ),
      )
      .orderBy(asc(commissionRules.createdAt));
    const ids = new Set(visible.map((row) => row.id));
    return rules
      .filter((rule) => ids.has(rule.id))
      .map((rule) => ({ ...rule, rates: [...rule.rates].map(([categoryId, rateBps]) => ({ categoryId, rateBps })) }))
      .sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? b.version - a.version : a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  });
}
