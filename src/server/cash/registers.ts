import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { cashRegisters, cashSessions, stores, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope, can } from "@/server/authz/guard";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import { registerInputSchema, registerNameSchema } from "./schemas";

// Cash registers of each store. Managing them needs cash.manage and the store
// in scope; listing needs cash.read or cash.operate.

const REGISTER_NOT_FOUND = () => notFound("Caixa não encontrado.");
const NAME_CONSTRAINT = "cash_registers_store_name_idx";

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

function translateNameTaken(error: unknown): never {
  if (isUniqueViolation(error, NAME_CONSTRAINT)) throw conflict("Já existe um caixa com este nome na loja.", { name: ["Nome já utilizado nesta loja."] });
  throw error;
}

export async function listRegisters(context: TenantContext, filters: { storeId?: string; status?: "active" | "inactive" } = {}) {
  if (!can(context, "cash.read") && !can(context, "cash.operate")) throw forbidden();
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    return tx
      .select({
        id: cashRegisters.id,
        storeId: cashRegisters.storeId,
        storeName: stores.name,
        name: cashRegisters.name,
        isActive: cashRegisters.isActive,
        openSessionId: cashSessions.id,
        openedByName: users.name,
        openedAt: cashSessions.openedAt,
      })
      .from(cashRegisters)
      .innerJoin(stores, and(eq(stores.organizationId, cashRegisters.organizationId), eq(stores.id, cashRegisters.storeId)))
      .leftJoin(
        cashSessions,
        and(eq(cashSessions.organizationId, cashRegisters.organizationId), eq(cashSessions.registerId, cashRegisters.id), eq(cashSessions.status, "open")),
      )
      .leftJoin(users, eq(users.id, cashSessions.openedBy))
      .where(
        and(
          eq(cashRegisters.organizationId, orgId),
          storeScopeCondition(context.storeScope, cashRegisters.storeId),
          filters.storeId ? eq(cashRegisters.storeId, filters.storeId) : undefined,
          filters.status ? eq(cashRegisters.isActive, filters.status === "active") : undefined,
        ),
      )
      .orderBy(asc(stores.name), asc(sql`lower(${cashRegisters.name})`))
      .limit(500)
      .then((rows) =>
        rows.map(({ openSessionId, openedByName, openedAt, ...row }) => ({
          ...row,
          openSession: openSessionId ? { id: openSessionId, openedByName, openedAt } : null,
        })),
      );
  });
}

export async function createRegister(context: TenantContext, rawInput: unknown) {
  assertCan(context, "cash.manage");
  const input = parse(registerInputSchema, rawInput);
  assertStoreInScope(context, input.storeId);
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      await assertFeature(tx, orgId, "pos");
      const [store] = await tx.select({ status: stores.status }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, input.storeId)));
      if (!store) throw notFound("Loja não encontrada.");
      if (store.status !== "active") throw invalid("Revise os campos destacados.", { storeId: ["Selecione uma loja ativa."] });
      const [created] = await tx.insert(cashRegisters).values({ organizationId: orgId, storeId: input.storeId, name: input.name }).returning({ id: cashRegisters.id });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "cash_register.created",
        entityType: "cash_register",
        entityId: created.id,
        storeId: input.storeId,
        changes: { name: input.name },
      });
      return { id: created.id };
    });
  } catch (error) {
    translateNameTaken(error);
  }
}

async function lockRegister(context: TenantContext, tx: Tx, registerId: string) {
  const [register] = await tx
    .select({ id: cashRegisters.id, storeId: cashRegisters.storeId, name: cashRegisters.name, isActive: cashRegisters.isActive })
    .from(cashRegisters)
    .where(and(eq(cashRegisters.organizationId, context.organization.id), eq(cashRegisters.id, registerId), storeScopeCondition(context.storeScope, cashRegisters.storeId)))
    .for("update");
  if (!register) throw REGISTER_NOT_FOUND();
  return register;
}

export async function updateRegister(context: TenantContext, registerId: string, rawInput: unknown) {
  assertCan(context, "cash.manage");
  const { name } = parse(registerNameSchema, rawInput);
  if (!isUuid(registerId)) throw REGISTER_NOT_FOUND();
  const orgId = context.organization.id;
  try {
    await withScope(dbScope(context), async (tx) => {
      await assertFeature(tx, orgId, "pos");
      const register = await lockRegister(context, tx, registerId);
      if (register.name === name) return;
      await tx.update(cashRegisters).set({ name, updatedAt: new Date() }).where(and(eq(cashRegisters.organizationId, orgId), eq(cashRegisters.id, registerId)));
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "cash_register.updated",
        entityType: "cash_register",
        entityId: registerId,
        storeId: register.storeId,
        changes: { name: { from: register.name, to: name } },
      });
    });
  } catch (error) {
    translateNameTaken(error);
  }
}

export async function setRegisterActive(context: TenantContext, registerId: string, isActive: boolean) {
  assertCan(context, "cash.manage");
  if (!isUuid(registerId)) throw REGISTER_NOT_FOUND();
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const register = await lockRegister(context, tx, registerId);
    if (register.isActive === isActive) return;
    if (!isActive) {
      const [open] = await tx
        .select({ id: cashSessions.id })
        .from(cashSessions)
        .where(and(eq(cashSessions.organizationId, orgId), eq(cashSessions.registerId, registerId), eq(cashSessions.status, "open")));
      if (open) throw invalid("Feche a sessão aberta antes de desativar o caixa.");
    }
    await tx.update(cashRegisters).set({ isActive, updatedAt: new Date() }).where(and(eq(cashRegisters.organizationId, orgId), eq(cashRegisters.id, registerId)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "cash_register.status_changed",
      entityType: "cash_register",
      entityId: registerId,
      storeId: register.storeId,
      changes: { isActive: { from: register.isActive, to: isActive } },
    });
  });
}
