import "server-only";
import { and, asc, count, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { organizationMemberships, roles, salespeople, salespersonStores, stores, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, resolveMembershipStores, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope, canManageRank } from "@/server/authz/guard";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { pageResult, pageWindow } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";
import type { z } from "zod";
import { salespersonSchema, type SalespeopleFilters } from "./schemas";

// Salespeople (m10a): a member linked to stores, with a POS code. Managers only
// manage members of a lower level (hierarchy rule) and only stores in their scope;
// links to stores outside the actor's scope are kept untouched on update.

const SALESPERSON_NOT_FOUND = () => notFound("Vendedor não encontrado.");

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

/** Salespeople linked to at least one store in scope (everyone with full access). */
export function visibleSalespeople(context: TenantContext): SQL | undefined {
  const inScope = storeScopeCondition(context.storeScope, salespersonStores.storeId);
  if (!inScope) return undefined;
  return sql`exists (select 1 from ${salespersonStores} where ${salespersonStores.organizationId} = ${salespeople.organizationId}
    and ${salespersonStores.salespersonId} = ${salespeople.id} and ${inScope})`;
}

async function loadMember(tx: Tx, context: TenantContext, membershipId: string) {
  const orgId = context.organization.id;
  const [member] = await tx
    .select({ id: organizationMemberships.id, status: organizationMemberships.status, storeAccess: organizationMemberships.storeAccess, rank: roles.rank })
    .from(organizationMemberships)
    .innerJoin(roles, and(eq(roles.organizationId, organizationMemberships.organizationId), eq(roles.id, organizationMemberships.roleId)))
    .where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.id, membershipId)));
  if (!member) throw notFound("Membro não encontrado.");
  if (!canManageRank(context, member.rank)) throw forbidden("Você só gerencia vendedores de nível inferior ao seu.");
  return member;
}

async function lockSalesperson(tx: Tx, context: TenantContext, salespersonId: string) {
  if (!isUuid(salespersonId)) throw SALESPERSON_NOT_FOUND();
  const [row] = await tx
    .select({ id: salespeople.id, membershipId: salespeople.membershipId, isActive: salespeople.isActive, code: salespeople.code })
    .from(salespeople)
    .where(and(eq(salespeople.organizationId, context.organization.id), eq(salespeople.id, salespersonId), visibleSalespeople(context)))
    .for("update");
  if (!row) throw SALESPERSON_NOT_FOUND();
  return row;
}

export async function saveSalesperson(context: TenantContext, rawInput: unknown, salespersonId?: string): Promise<{ id: string }> {
  assertCan(context, "salespeople.manage");
  const input = parse(salespersonSchema, rawInput);
  for (const storeId of input.storeIds) assertStoreInScope(context, storeId);
  const orgId = context.organization.id;
  const storeIds = [...new Set(input.storeIds)];
  try {
    return await withScope(dbScope(context), async (tx) => {
      const current = salespersonId === undefined ? null : await lockSalesperson(tx, context, salespersonId);
      if (current && current.membershipId !== input.membershipId) throw invalid("O membro de um vendedor não pode ser trocado.");
      const member = await loadMember(tx, context, input.membershipId);
      if (member.status !== "active") throw invalid("Revise os campos destacados.", { membershipId: ["Escolha um membro ativo."] });
      const [found] = await tx.select({ value: count() }).from(stores).where(and(eq(stores.organizationId, orgId), inArray(stores.id, storeIds)));
      if (found.value !== storeIds.length) throw notFound("Loja não encontrada.");
      const reach = member.storeAccess === "all" ? null : new Set(await resolveMembershipStores(tx, orgId, member.id));
      if (reach && storeIds.some((id) => !reach.has(id))) throw invalid("Revise os campos destacados.", { storeIds: ["O membro não tem acesso a uma das lojas escolhidas."] });

      let id = current?.id;
      if (!id) {
        const [created] = await tx.insert(salespeople).values({ organizationId: orgId, membershipId: input.membershipId, code: input.code, nickname: input.nickname }).returning({ id: salespeople.id });
        id = created.id;
      } else {
        await tx.update(salespeople).set({ code: input.code, nickname: input.nickname, updatedAt: new Date() }).where(and(eq(salespeople.organizationId, orgId), eq(salespeople.id, id)));
        // Only links the actor can see are replaced.
        const inScope = storeScopeCondition(context.storeScope, salespersonStores.storeId);
        await tx
          .delete(salespersonStores)
          .where(and(eq(salespersonStores.organizationId, orgId), eq(salespersonStores.salespersonId, id), notInArray(salespersonStores.storeId, storeIds), inScope));
      }
      await tx.insert(salespersonStores).values(storeIds.map((storeId) => ({ organizationId: orgId, salespersonId: id, storeId }))).onConflictDoNothing();
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "salesperson.saved",
        entityType: "salesperson",
        entityId: id,
        changes: { code: input.code, nickname: input.nickname, storeIds },
      });
      return { id };
    });
  } catch (error) {
    if (isUniqueViolation(error, "salespeople_org_code_key")) throw conflict("Código já usado por outro vendedor.", { code: ["Código já usado por outro vendedor."] });
    if (isUniqueViolation(error, "salespeople_org_membership_key")) throw conflict("Este membro já é vendedor.", { membershipId: ["Este membro já é vendedor."] });
    throw error;
  }
}

export async function setSalespersonActive(context: TenantContext, salespersonId: string, isActive: boolean): Promise<void> {
  assertCan(context, "salespeople.manage");
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const current = await lockSalesperson(tx, context, salespersonId);
    await loadMember(tx, context, current.membershipId);
    if (current.isActive === isActive) return;
    await tx.update(salespeople).set({ isActive, updatedAt: new Date() }).where(and(eq(salespeople.organizationId, orgId), eq(salespeople.id, current.id)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "salesperson.status_changed",
      entityType: "salesperson",
      entityId: current.id,
      changes: { code: current.code, isActive },
    });
  });
}

export async function listSalespeople(context: TenantContext, filters: SalespeopleFilters) {
  assertCan(context, "members.read");
  const orgId = context.organization.id;
  const inScope = storeScopeCondition(context.storeScope, salespersonStores.storeId);
  const conditions: (SQL | undefined)[] = [eq(salespeople.organizationId, orgId), visibleSalespeople(context)];
  if (filters.status) conditions.push(eq(salespeople.isActive, filters.status === "active"));
  if (filters.storeId) {
    conditions.push(sql`exists (select 1 from ${salespersonStores} where ${salespersonStores.organizationId} = ${salespeople.organizationId}
      and ${salespersonStores.salespersonId} = ${salespeople.id} and ${salespersonStores.storeId} = ${filters.storeId})`);
  }
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(salespeople).where(where);
    const rows = await tx
      .select({
        id: salespeople.id,
        code: salespeople.code,
        nickname: salespeople.nickname,
        isActive: salespeople.isActive,
        membershipId: salespeople.membershipId,
        userId: organizationMemberships.userId,
        name: users.name,
        // Only the stores the reader can see.
        storeIds: sql<string[]>`coalesce((select array_agg(${salespersonStores.storeId} order by ${salespersonStores.storeId}) from ${salespersonStores}
          where ${salespersonStores.organizationId} = ${salespeople.organizationId} and ${salespersonStores.salespersonId} = ${salespeople.id}${inScope ? sql` and ${inScope}` : sql``}), '{}')`,
      })
      .from(salespeople)
      .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, salespeople.organizationId), eq(organizationMemberships.id, salespeople.membershipId)))
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(where)
      .orderBy(asc(salespeople.code))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}
