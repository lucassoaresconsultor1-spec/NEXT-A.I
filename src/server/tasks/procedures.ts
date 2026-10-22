import "server-only";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { procedures } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, can } from "@/server/authz/guard";
import { conflict, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf, requiredText } from "@/server/forms";
import { likePattern } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";

// Written procedures of the organization (m38a): readers see the active ones;
// managers keep them up to date. Searchable by title and text.

const procedureSchema = z.object({ title: requiredText("o título", 160, 3), body: requiredText("o texto", 20_000, 10) });

export async function saveProcedure(context: TenantContext, rawInput: unknown, procedureId?: string): Promise<{ id: string }> {
  assertCan(context, "procedures.manage");
  const parsed = procedureSchema.safeParse(rawInput);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      let id = procedureId;
      if (id === undefined) {
        [{ id }] = await tx.insert(procedures).values({ organizationId: orgId, ...parsed.data, updatedBy: context.user.id }).returning({ id: procedures.id });
      } else {
        if (!isUuid(id)) throw notFound("Procedimento não encontrado.");
        const [updated] = await tx.update(procedures).set({ ...parsed.data, updatedBy: context.user.id, updatedAt: new Date() }).where(and(eq(procedures.organizationId, orgId), eq(procedures.id, id))).returning({ id: procedures.id });
        if (!updated) throw notFound("Procedimento não encontrado.");
      }
      await recordAudit(tx, { organizationId: orgId, actorUserId: context.user.id, action: "procedure.saved", entityType: "procedure", entityId: id!, changes: { title: parsed.data.title } });
      return { id: id! };
    });
  } catch (error) {
    if (isUniqueViolation(error, "procedures_org_title_idx")) throw conflict("Já existe um procedimento com este título.", { title: ["Já existe um procedimento com este título."] });
    throw error;
  }
}

export async function setProcedureActive(context: TenantContext, procedureId: string, isActive: boolean): Promise<void> {
  assertCan(context, "procedures.manage");
  if (!isUuid(procedureId)) throw notFound("Procedimento não encontrado.");
  await withScope(dbScope(context), async (tx) => {
    const [updated] = await tx.update(procedures).set({ isActive, updatedAt: new Date() }).where(and(eq(procedures.organizationId, context.organization.id), eq(procedures.id, procedureId))).returning({ id: procedures.id });
    if (!updated) throw notFound("Procedimento não encontrado.");
    await recordAudit(tx, { organizationId: context.organization.id, actorUserId: context.user.id, action: "procedure.status_changed", entityType: "procedure", entityId: procedureId, changes: { isActive } });
  });
}

const readable = (context: TenantContext) => (can(context, "procedures.manage") ? undefined : eq(procedures.isActive, true));

export async function listProcedures(context: TenantContext, filters: { q?: string } = {}) {
  assertCan(context, "procedures.read");
  const q = filters.q?.trim().slice(0, 80);
  return withScope(dbScope(context), (tx) =>
    tx
      .select({ id: procedures.id, title: procedures.title, isActive: procedures.isActive, updatedAt: procedures.updatedAt })
      .from(procedures)
      .where(and(eq(procedures.organizationId, context.organization.id), readable(context), q ? or(ilike(procedures.title, likePattern(q)), ilike(procedures.body, likePattern(q))) : undefined))
      .orderBy(asc(procedures.title))
      .limit(200),
  );
}

export async function getProcedure(context: TenantContext, procedureId: string) {
  assertCan(context, "procedures.read");
  if (!isUuid(procedureId)) return null;
  const [row] = await withScope(dbScope(context), (tx) => tx.select().from(procedures).where(and(eq(procedures.organizationId, context.organization.id), eq(procedures.id, procedureId), readable(context))));
  return row ?? null;
}
