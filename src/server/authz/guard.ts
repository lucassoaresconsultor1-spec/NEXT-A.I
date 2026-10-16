import "server-only";
import { forbidden, notFound } from "@/server/errors";
import { isStoreInScope, type TenantContext } from "./context";
import type { Permission } from "./permissions";
import { OWNER_ROLE_KEY } from "./system-roles";

export function can(context: TenantContext, permission: Permission) {
  return context.permissions.has(permission);
}

export function assertCan(context: TenantContext, permission: Permission) {
  if (!can(context, permission)) throw forbidden();
}

/** Organization-wide structure changes (stores, regions, settings) need full store access. */
export function assertOrganizationWide(context: TenantContext) {
  if (!context.storeScope.all) throw forbidden("Esta ação exige acesso a todas as lojas da empresa.");
}

/** Out-of-scope stores answer as "not found" so their existence is not disclosed. */
export function assertStoreInScope(context: TenantContext, storeId: string) {
  if (!isStoreInScope(context.storeScope, storeId)) throw notFound("Loja não encontrada.");
}

export function isOwner(context: TenantContext) {
  return context.role.isSystem && context.role.key === OWNER_ROLE_KEY;
}

/** Owners manage everyone; other roles only manage strictly lower ranks. */
export function canManageRank(context: TenantContext, targetRank: number) {
  return isOwner(context) || targetRank < context.role.rank;
}
