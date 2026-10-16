import "server-only";
import { isStoreInScope, type TenantContext } from "@/server/authz/context";
import { canManageRank, isOwner } from "@/server/authz/guard";
import type { Permission } from "@/server/authz/permissions";
import { OWNER_ROLE_KEY, type StoreAccess } from "@/server/authz/system-roles";
import { conflict, DomainError, forbidden, invalid, notFound } from "@/server/errors";

// Anti-privilege-escalation decisions for the members module. No I/O: the
// service loads the facts (target membership, ids found in the organization,
// active owner count) and calls these before writing anything.

export const MEMBER_NOT_FOUND = () => notFound("Membro não encontrado.");
export const ROLE_INVALID = () => invalid("Perfil inválido.", { roleId: ["Selecione um perfil válido."] });
export const EMAIL_TAKEN = () => conflict("Esta pessoa já faz parte da equipe.", { email: ["E-mail já cadastrado nesta empresa."] });
export const EMAIL_IN_USE = () =>
  conflict(
    "Este e-mail já tem uma conta criada por outra empresa. Por segurança, contas existentes só poderão ser vinculadas com confirmação por e-mail (ainda não disponível). Use outro e-mail ou fale com o suporte.",
    { email: ["E-mail já usado em outra conta."] },
  );
export const SELF_SERVICE_PASSWORD =
  "Por segurança, esta pessoa precisa trocar a senha por conta própria, pela opção Alterar senha depois de entrar.";

export const SELF_CHANGE_MESSAGE = "Você não pode alterar o próprio acesso.";
export const LAST_OWNER_MESSAGE =
  "A empresa precisa de ao menos um dono ativo. Defina outro dono antes desta alteração.";

export interface RoleFacts {
  key: string;
  isSystem: boolean;
  rank: number;
}

export interface TargetFacts {
  membershipId: string;
  status: "active" | "suspended";
  storeAccess: StoreAccess;
  /** Explicit store links of the target (all of them, not only the viewer's). */
  storeIds: readonly string[];
  role: RoleFacts;
}

export function isOwnerRole(role: Pick<RoleFacts, "key" | "isSystem">) {
  return role.isSystem && role.key === OWNER_ROLE_KEY;
}

export function isActiveOwner(target: Pick<TargetFacts, "status" | "role">) {
  return target.status === "active" && isOwnerRole(target.role);
}

/** A role being assigned, with its resolved permissions (system roles from code, custom from the database). */
export interface AssignableRoleFacts extends RoleFacts {
  permissions: readonly string[];
}

/** Every permission of the role is held by the actor (owners hold them all by definition). */
export function holdsRolePermissions(context: TenantContext, role: AssignableRoleFacts) {
  return isOwner(context) || role.permissions.every((permission) => context.permissions.has(permission as Permission));
}

/**
 * Roles strictly below the actor's rank (owners: any rank) whose permissions the
 * actor also holds; the owner role only by owners. Granting a role is granting
 * its permissions, so a lower rank alone is not enough.
 */
export function canAssignRole(context: TenantContext, role: AssignableRoleFacts) {
  return canManageRank(context, role.rank) && (!isOwnerRole(role) || isOwner(context)) && holdsRolePermissions(context, role);
}

export type ManageBlock = "permission" | "self" | "rank" | "scope";

/**
 * Why the actor cannot manage this (already visible) membership, or null when
 * they can. Actors without organization-wide access only manage store-level
 * members whose stores are all inside their own scope, so they never change
 * access they do not control.
 */
export function manageBlock(context: TenantContext, target: TargetFacts): ManageBlock | null {
  if (!context.permissions.has("members.manage")) return "permission";
  if (target.membershipId === context.membershipId) return "self";
  if (!canManageRank(context, target.role.rank)) return "rank";
  if (!context.storeScope.all) {
    const inScope = target.storeIds.every((storeId) => isStoreInScope(context.storeScope, storeId));
    if (target.storeAccess !== "stores" || !inScope) return "scope";
  }
  return null;
}

export const MANAGE_BLOCK_MESSAGES: Record<ManageBlock, string> = {
  permission: "Você não tem permissão para esta ação.",
  self: SELF_CHANGE_MESSAGE,
  rank: "Você só pode gerenciar membros com perfil de nível inferior ao seu.",
  scope: "Este membro tem acesso fora do seu escopo de lojas. Peça a um administrador da empresa para alterá-lo.",
};

export function assertCanManage(context: TenantContext, target: TargetFacts) {
  const block = manageBlock(context, target);
  if (block) throw forbidden(MANAGE_BLOCK_MESSAGES[block]);
}

export function assertCanAssignRole(context: TenantContext, role: AssignableRoleFacts) {
  if (canAssignRole(context, role)) return;
  const message = isOwnerRole(role)
    ? "Somente donos podem atribuir o perfil Dono."
    : !canManageRank(context, role.rank)
      ? "Você só pode atribuir perfis de nível inferior ao seu."
      : "Este perfil inclui permissões que você não possui.";
  throw new DomainError(message, "forbidden", { roleId: [message] });
}

export interface ScopeInput {
  storeAccess: StoreAccess;
  regionIds: readonly string[];
  storeIds: readonly string[];
}

export interface ResolvedScope {
  storeAccess: StoreAccess;
  regionIds: string[];
  storeIds: string[];
}

/** Ids of the request that exist in the organization (looked up by the service). */
export interface KnownScopeIds {
  regionIds: ReadonlySet<string>;
  storeIds: ReadonlySet<string>;
}

const scopeForbidden = (message: string) => new DomainError(message, "forbidden", { storeAccess: [message] });

/**
 * Validates the requested scope and returns it normalized: only the links that
 * match the chosen access mode are kept. Stores outside the actor's scope are
 * reported exactly like unknown ids, so their existence is not disclosed.
 */
export function resolveScope(context: TenantContext, input: ScopeInput, known: KnownScopeIds): ResolvedScope {
  const organizationWide = context.storeScope.all;
  const regionIds = [...new Set(input.regionIds)];
  const storeIds = [...new Set(input.storeIds)];
  if (input.storeAccess === "all") {
    if (!organizationWide) throw scopeForbidden("Somente quem tem acesso a todas as lojas pode conceder esse escopo.");
    return { storeAccess: "all", regionIds: [], storeIds: [] };
  }
  if (input.storeAccess === "regions") {
    if (!organizationWide) throw scopeForbidden("Somente quem tem acesso a todas as lojas pode conceder acesso por região.");
    if (regionIds.length === 0) throw invalid("Selecione ao menos uma região.", { regionIds: ["Selecione ao menos uma região."] });
    if (!regionIds.every((id) => known.regionIds.has(id))) {
      throw invalid("Região inválida.", { regionIds: ["Selecione regiões válidas."] });
    }
    return { storeAccess: "regions", regionIds, storeIds: [] };
  }
  if (storeIds.length === 0) throw invalid("Selecione ao menos uma loja.", { storeIds: ["Selecione ao menos uma loja."] });
  const allowed = (id: string) => known.storeIds.has(id) && isStoreInScope(context.storeScope, id);
  if (!storeIds.every(allowed)) throw invalid("Loja inválida.", { storeIds: ["Selecione lojas válidas do seu escopo."] });
  return { storeAccess: "stores", regionIds: [], storeIds };
}

/** True when the change would leave the organization without an active owner. */
export function removesLastActiveOwner(targetIsActiveOwner: boolean, staysActiveOwner: boolean, activeOwnerCount: number) {
  return targetIsActiveOwner && !staysActiveOwner && activeOwnerCount <= 1;
}

export function assertKeepsActiveOwner(targetIsActiveOwner: boolean, staysActiveOwner: boolean, activeOwnerCount: number) {
  if (removesLastActiveOwner(targetIsActiveOwner, staysActiveOwner, activeOwnerCount)) throw conflict(LAST_OWNER_MESSAGE);
}

export interface AccessEntry {
  id: string;
  /** Human-readable label written to the audit trail. */
  name: string;
}

export interface AccessSnapshot {
  role: AccessEntry;
  storeAccess: StoreAccess;
  regions: readonly AccessEntry[];
  stores: readonly AccessEntry[];
}

const idKey = (entries: readonly AccessEntry[]) => entries.map((entry) => entry.id).sort().join(",");
const labels = (entries: readonly AccessEntry[]) => entries.map((entry) => entry.name).sort();

/**
 * Role and scope changes compared by id (names may repeat) and reported by
 * label for the audit trail; empty when nothing changed. Never holds secrets.
 */
export function accessChanges(before: AccessSnapshot, after: AccessSnapshot) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (before.role.id !== after.role.id) changes.role = { from: before.role.name, to: after.role.name };
  if (before.storeAccess !== after.storeAccess) changes.storeAccess = { from: before.storeAccess, to: after.storeAccess };
  if (idKey(before.regions) !== idKey(after.regions)) changes.regions = { from: labels(before.regions), to: labels(after.regions) };
  if (idKey(before.stores) !== idKey(after.stores)) changes.stores = { from: labels(before.stores), to: labels(after.stores) };
  return changes;
}
