import "server-only";
import { and, count, eq, isNotNull, ne, sql } from "drizzle-orm";
import { departments, organizationMemberships, organizations, regions, stores } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { countUsage, getOrganizationPlan } from "@/server/plans/entitlements";

/**
 * Phase 1 overview: structural counts only. Sales, goals and stock indicators
 * appear here when their modules exist, computed by shared domain services.
 */
export async function getOverview(context: TenantContext) {
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const [storeCounts] = await tx
      .select({ total: count(), active: sql<number>`(count(*) filter (where ${stores.status} = 'active'))::int` })
      .from(stores)
      .where(and(eq(stores.organizationId, orgId), storeScopeCondition(context.storeScope, stores.id)));
    const [regionCount] = await tx.select({ value: count() }).from(regions).where(eq(regions.organizationId, orgId));
    const [departmentCount] = await tx
      .select({ value: count() })
      .from(departments)
      .where(and(eq(departments.organizationId, orgId), eq(departments.isActive, true)));

    const organizationWide = context.storeScope.all;
    let memberCount: number | null = null;
    if (organizationWide && can(context, "members.read")) {
      const [members] = await tx
        .select({ value: count() })
        .from(organizationMemberships)
        .where(and(eq(organizationMemberships.organizationId, orgId), ne(organizationMemberships.status, "suspended")));
      memberCount = members.value;
    }

    let plan: { name: string; maxStores: number | null; maxMembers: number | null; usage: { stores: number; members: number } } | null = null;
    if (can(context, "organization.settings.read") && organizationWide) {
      const details = await getOrganizationPlan(tx, orgId);
      plan = { name: details.name, maxStores: details.maxStores, maxMembers: details.maxMembers, usage: await countUsage(tx, orgId) };
    }

    let onboarding: { label: string; done: boolean; href: string }[] | null = null;
    if (organizationWide && can(context, "stores.manage")) {
      const [org] = await tx
        .select({ hasDocument: isNotNull(organizations.document) })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      onboarding = [
        { label: "Completar dados da empresa (CNPJ)", done: Boolean(org?.hasDocument), href: "/configuracoes" },
        { label: "Cadastrar a primeira loja", done: storeCounts.total > 0, href: "/lojas/nova" },
        { label: "Organizar lojas em regiões (redes)", done: regionCount.value > 0, href: "/regioes" },
        { label: "Adicionar a equipe", done: (memberCount ?? 0) > 1, href: "/equipe/novo" },
      ];
    }

    let activeStore: { id: string; code: string; name: string; city: string | null; state: string | null } | null = null;
    if (context.activeStoreId) {
      const [store] = await tx
        .select({ id: stores.id, code: stores.code, name: stores.name, city: stores.city, state: stores.state })
        .from(stores)
        .where(and(eq(stores.organizationId, orgId), eq(stores.id, context.activeStoreId)));
      activeStore = store ?? null;
    }

    return {
      stores: { total: storeCounts.total, active: storeCounts.active },
      regions: can(context, "regions.read") ? regionCount.value : null,
      departments: can(context, "departments.read") ? departmentCount.value : null,
      members: memberCount,
      plan,
      onboarding,
      activeStore,
    };
  });
}
