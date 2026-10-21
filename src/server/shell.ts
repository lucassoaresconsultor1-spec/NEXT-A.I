import "server-only";
import { eq } from "drizzle-orm";
import { plans } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import type { Permission } from "@/server/authz/permissions";
import { listStoreOptions } from "@/server/stores/options";

// Navigation entries and the permission that unlocks each one. Pages enforce the
// same permission again; this list only decides what the menu shows.
const NAV_PERMISSIONS: Record<string, Permission | null> = {
  "/painel": null,
  "/lojas": "stores.read",
  "/regioes": "regions.read",
  "/departamentos": "departments.read",
  "/produtos": "catalog.read",
  "/categorias": "catalog.read",
  "/marcas": "catalog.read",
  "/fornecedores": "catalog.read",
  "/equipe": "members.read",
  "/perfis": "roles.read",
  "/auditoria": "audit.read",
  "/configuracoes": "organization.settings.read",
};

export async function getShellData(context: TenantContext) {
  const allowedNav = Object.entries(NAV_PERMISSIONS)
    .filter(([, permission]) => permission === null || can(context, permission))
    .map(([href]) => href);
  const [stores, plan] = await Promise.all([
    can(context, "stores.read") ? listStoreOptions(context) : Promise.resolve([]),
    withScope(dbScope(context), (tx) =>
      tx.select({ name: plans.name }).from(plans).where(eq(plans.key, context.organization.planKey)),
    ),
  ]);
  return {
    organizationName: context.organization.name,
    planName: plan[0]?.name ?? context.organization.planKey,
    allowedNav,
    stores: stores.map((store) => ({ id: store.id, code: store.code, name: store.name })),
    activeStoreId: context.activeStoreId,
    user: {
      name: context.user.name,
      email: context.user.email,
      roleName: context.role.name,
      isPlatformAdmin: context.user.isPlatformAdmin,
    },
  };
}
