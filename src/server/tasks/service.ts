import "server-only";
import { and, asc, count, desc, eq, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { aiConversations, alerts, organizationMemberships, stores, taskEvents, tasks } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, resolveMembershipStores, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide, assertStoreInScope, can } from "@/server/authz/guard";
import { forbidden, invalid, notFound } from "@/server/errors";
import { fieldErrorsOf, optionalText, requiredText } from "@/server/forms";
import { pageResult, pageWindow, parsePage } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";

// Management tasks (m38a). Only people create tasks (the assistant has no tool for
// it): from scratch, from an alert or from one of their assistant conversations.
// The assignee always sees and moves their own task.

const TASK_NOT_FOUND = () => notFound("Tarefa não encontrada.");
const optionalId = z.preprocess((value) => (value === "" ? undefined : value), z.uuid({ error: "Seleção inválida." }).optional());

const createSchema = z.object({
  title: requiredText("o título", 160, 3),
  description: optionalText(2000),
  storeId: optionalId,
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  dueDate: z.preprocess((value) => (value === "" ? undefined : value), z.iso.date({ error: "Prazo inválido." }).optional()),
  assigneeMembershipId: optionalId,
  alertId: optionalId,
  conversationId: optionalId,
});
const statusSchema = z.object({ status: z.enum(["in_progress", "done", "cancelled"]), note: optionalText(1000) });

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

async function event(tx: Tx, context: TenantContext, taskId: string, kind: "created" | "status_changed" | "assigned" | "comment", text: string | null) {
  await tx.insert(taskEvents).values({ organizationId: context.organization.id, taskId, kind, text, actorUserId: context.user.id });
}

/** The assignee must be active and reach the task's store (or have full access for tasks without a store). */
async function assertAssignee(tx: Tx, organizationId: string, membershipId: string, storeId: string | null) {
  const [member] = await tx
    .select({ id: organizationMemberships.id, storeAccess: organizationMemberships.storeAccess })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.id, membershipId), eq(organizationMemberships.status, "active")));
  if (!member) throw invalid("Revise os campos destacados.", { assigneeMembershipId: ["Escolha um membro ativo."] });
  if (member.storeAccess === "all") return;
  if (!storeId || !(await resolveMembershipStores(tx, organizationId, member.id)).includes(storeId)) {
    throw invalid("Revise os campos destacados.", { assigneeMembershipId: ["Este membro não tem acesso à loja da tarefa."] });
  }
}

export async function createTask(context: TenantContext, rawInput: unknown): Promise<{ id: string }> {
  assertCan(context, "tasks.manage");
  const input = parse(createSchema, rawInput);
  if (input.alertId && input.conversationId) throw invalid("Uma tarefa nasce de um alerta ou de uma conversa, não dos dois.");
  if (input.storeId) assertStoreInScope(context, input.storeId);
  else assertOrganizationWide(context);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    if (input.storeId) {
      const [store] = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, input.storeId)));
      if (!store) throw notFound("Loja não encontrada.");
    }
    if (input.alertId) {
      const [alert] = await tx.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.organizationId, orgId), eq(alerts.id, input.alertId), storeScopeCondition(context.storeScope, alerts.storeId)));
      if (!alert) throw notFound("Alerta não encontrado.");
    }
    if (input.conversationId) {
      const [conversation] = await tx
        .select({ id: aiConversations.id })
        .from(aiConversations)
        .where(and(eq(aiConversations.organizationId, orgId), eq(aiConversations.id, input.conversationId), eq(aiConversations.userId, context.user.id)));
      if (!conversation) throw notFound("Conversa não encontrada.");
    }
    if (input.assigneeMembershipId) await assertAssignee(tx, orgId, input.assigneeMembershipId, input.storeId ?? null);
    const source = input.alertId ? "alert" : input.conversationId ? "assistant" : "manual";
    const [created] = await tx
      .insert(tasks)
      .values({
        organizationId: orgId,
        storeId: input.storeId ?? null,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        assigneeMembershipId: input.assigneeMembershipId ?? null,
        source,
        alertId: input.alertId ?? null,
        conversationId: input.conversationId ?? null,
        createdBy: context.user.id,
      })
      .returning({ id: tasks.id });
    await event(tx, context, created.id, "created", input.title);
    await recordAudit(tx, { organizationId: orgId, actorUserId: context.user.id, action: "task.created", entityType: "task", entityId: created.id, storeId: input.storeId ?? null, changes: { title: input.title, source, priority: input.priority } });
    return { id: created.id };
  });
}

/** Tasks the member may see: their own assignments, plus (with tasks.read) the ones of stores in scope. */
function visible(context: TenantContext): SQL | undefined {
  const own = eq(tasks.assigneeMembershipId, context.membershipId);
  if (!can(context, "tasks.read")) return own;
  if (context.storeScope.all) return undefined;
  return or(own, storeScopeCondition(context.storeScope, tasks.storeId));
}

async function lockTask(tx: Tx, context: TenantContext, taskId: string) {
  if (!isUuid(taskId)) throw TASK_NOT_FOUND();
  const [task] = await tx
    .select({ id: tasks.id, storeId: tasks.storeId, status: tasks.status, assignee: tasks.assigneeMembershipId })
    .from(tasks)
    .where(and(eq(tasks.organizationId, context.organization.id), eq(tasks.id, taskId), visible(context)))
    .for("update");
  if (!task) throw TASK_NOT_FOUND();
  return task;
}

export async function updateTaskStatus(context: TenantContext, taskId: string, rawInput: unknown): Promise<void> {
  const input = parse(statusSchema, rawInput);
  if (input.status === "cancelled" && !input.note) throw invalid("Revise os campos destacados.", { note: ["Informe o motivo do cancelamento."] });
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const task = await lockTask(tx, context, taskId);
    if (task.assignee !== context.membershipId && !can(context, "tasks.manage")) throw forbidden("Só o responsável ou a gestão mudam esta tarefa.");
    if (task.status === "done" || task.status === "cancelled") throw invalid("Esta tarefa já foi encerrada.");
    const closed = input.status === "done" || input.status === "cancelled";
    await tx.update(tasks).set({ status: input.status, closedAt: closed ? new Date() : null, updatedAt: new Date() }).where(and(eq(tasks.organizationId, orgId), eq(tasks.id, task.id)));
    await event(tx, context, task.id, "status_changed", input.note ? `${input.status}: ${input.note}` : input.status);
    await recordAudit(tx, { organizationId: orgId, actorUserId: context.user.id, action: "task.status_changed", entityType: "task", entityId: task.id, storeId: task.storeId, changes: { status: input.status } });
  });
}

export async function assignTask(context: TenantContext, taskId: string, membershipId: string): Promise<void> {
  assertCan(context, "tasks.manage");
  if (!isUuid(membershipId)) throw notFound("Membro não encontrado.");
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const task = await lockTask(tx, context, taskId);
    if (task.status === "done" || task.status === "cancelled") throw invalid("Esta tarefa já foi encerrada.");
    await assertAssignee(tx, orgId, membershipId, task.storeId);
    await tx.update(tasks).set({ assigneeMembershipId: membershipId, updatedAt: new Date() }).where(and(eq(tasks.organizationId, orgId), eq(tasks.id, task.id)));
    await event(tx, context, task.id, "assigned", null);
    await recordAudit(tx, { organizationId: orgId, actorUserId: context.user.id, action: "task.assigned", entityType: "task", entityId: task.id, storeId: task.storeId, changes: { membershipId } });
  });
}

export async function commentTask(context: TenantContext, taskId: string, rawInput: unknown): Promise<void> {
  const { text } = parse(z.object({ text: requiredText("o comentário", 1000, 1) }), rawInput);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const task = await lockTask(tx, context, taskId);
    await event(tx, context, task.id, "comment", text);
    await recordAudit(tx, { organizationId: orgId, actorUserId: context.user.id, action: "task.commented", entityType: "task", entityId: task.id, storeId: task.storeId, changes: {} });
  });
}

export async function listTasks(context: TenantContext, filters: { status?: "open" | "in_progress" | "done" | "cancelled"; storeId?: string; mine?: boolean; page?: unknown } = {}) {
  const page = parsePage(filters.page);
  const where = and(
    eq(tasks.organizationId, context.organization.id),
    visible(context),
    filters.status ? eq(tasks.status, filters.status) : undefined,
    filters.storeId && isUuid(filters.storeId) ? eq(tasks.storeId, filters.storeId) : undefined,
    filters.mine ? eq(tasks.assigneeMembershipId, context.membershipId) : undefined,
  );
  const { limit, offset } = pageWindow(page);
  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(tasks).where(where);
    const rows = await tx.select().from(tasks).where(where).orderBy(asc(tasks.dueDate), desc(tasks.createdAt)).limit(limit).offset(offset);
    return pageResult(rows, total.value, page);
  });
}

export async function getTask(context: TenantContext, taskId: string) {
  if (!isUuid(taskId)) return null;
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const [task] = await tx.select().from(tasks).where(and(eq(tasks.organizationId, orgId), eq(tasks.id, taskId), visible(context)));
    if (!task) return null;
    const events = await tx.select().from(taskEvents).where(and(eq(taskEvents.organizationId, orgId), eq(taskEvents.taskId, taskId))).orderBy(asc(taskEvents.createdAt));
    return { ...task, events };
  });
}
