import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { departments } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { diffFields, recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide } from "@/server/authz/guard";
import { conflict, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf, optionalText, requiredText } from "@/server/forms";

// Departments are an organization-level catalog (sectors such as "Eletro" or
// "Móveis") shared by every store. Any member with departments.read can list
// them; changes need departments.manage plus organization-wide store access.

export const departmentInputSchema = z.object({
  name: requiredText("o nome do departamento", 80, 2),
  description: optionalText(240),
});
export type DepartmentInput = z.infer<typeof departmentInputSchema>;

export const DEPARTMENT_STATUSES = ["active", "inactive"] as const;
export type DepartmentStatus = (typeof DEPARTMENT_STATUSES)[number];

export const DEPARTMENT_LIST_LIMIT = 500;

const NAME_CONSTRAINT = "departments_org_name_idx";
const NAME_TAKEN = () => conflict("Já existe um departamento com este nome.", { name: ["Nome já utilizado."] });
const NOT_FOUND = () => notFound("Departamento não encontrado.");

/** Services re-validate typed input too, so callers other than the form cannot bypass the rules. */
function parseInput(input: DepartmentInput) {
  const parsed = departmentInputSchema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return { name: parsed.data.name, description: parsed.data.description ?? null };
}

function assertCanManage(context: TenantContext) {
  assertCan(context, "departments.manage");
  assertOrganizationWide(context);
}

/** Locks the row for the rest of the transaction; other organizations' rows answer as missing. */
async function lockDepartment(tx: Tx, organizationId: string, departmentId: string) {
  const [current] = await tx
    .select({ name: departments.name, description: departments.description, isActive: departments.isActive })
    .from(departments)
    .where(and(eq(departments.organizationId, organizationId), eq(departments.id, departmentId)))
    .for("update");
  if (!current) throw NOT_FOUND();
  return current;
}

const departmentId = z.uuid();

/** Ids that are not UUIDs can never match a row; treating them as missing avoids a database error. */
function assertDepartmentId(id: string) {
  if (!departmentId.safeParse(id).success) throw NOT_FOUND();
}

export async function listDepartments(context: TenantContext, filters: { status?: DepartmentStatus } = {}) {
  assertCan(context, "departments.read");
  const orgId = context.organization.id;
  const statusCondition = filters.status ? eq(departments.isActive, filters.status === "active") : undefined;
  return withScope(dbScope(context), (tx) =>
    tx
      .select({
        id: departments.id,
        name: departments.name,
        description: departments.description,
        isActive: departments.isActive,
      })
      .from(departments)
      .where(and(eq(departments.organizationId, orgId), statusCondition))
      .orderBy(asc(departments.name), asc(departments.id))
      .limit(DEPARTMENT_LIST_LIMIT),
  );
}

export async function createDepartment(context: TenantContext, input: DepartmentInput) {
  assertCanManage(context);
  const values = parseInput(input);
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      const [created] = await tx
        .insert(departments)
        .values({ organizationId: orgId, ...values })
        .returning({ id: departments.id });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "department.created",
        entityType: "department",
        entityId: created.id,
        changes: values,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error, NAME_CONSTRAINT)) throw NAME_TAKEN();
    throw error;
  }
}

/** Saving without changes writes nothing (no update, no audit entry). */
export async function updateDepartment(context: TenantContext, id: string, input: DepartmentInput) {
  assertCanManage(context);
  const next = parseInput(input);
  assertDepartmentId(id);
  const orgId = context.organization.id;
  try {
    await withScope(dbScope(context), async (tx) => {
      const current = await lockDepartment(tx, orgId, id);
      const changes = diffFields(current, next, ["name", "description"]);
      if (Object.keys(changes).length === 0) return;
      await tx
        .update(departments)
        .set({ ...next, updatedAt: new Date() })
        .where(and(eq(departments.organizationId, orgId), eq(departments.id, id)));
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "department.updated",
        entityType: "department",
        entityId: id,
        changes,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, NAME_CONSTRAINT)) throw NAME_TAKEN();
    throw error;
  }
}

/** Activation is recorded as department.updated with an isActive diff; repeating the current state is a no-op. */
export async function setDepartmentActive(context: TenantContext, id: string, isActive: boolean) {
  assertCanManage(context);
  assertDepartmentId(id);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const current = await lockDepartment(tx, orgId, id);
    if (current.isActive === isActive) return;
    await tx
      .update(departments)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(departments.organizationId, orgId), eq(departments.id, id)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "department.updated",
      entityType: "department",
      entityId: id,
      changes: { isActive: { from: current.isActive, to: isActive } },
    });
  });
}

/**
 * Phase 1: nothing references departments yet, so deletion is unconditional.
 * Once other modules link to departments (queue distribution, goals, members),
 * a reference check is REQUIRED here: refuse with invalid() while links exist
 * and suggest deactivating instead, as deleteRegion does for scoped members.
 */
export async function deleteDepartment(context: TenantContext, id: string) {
  assertCanManage(context);
  assertDepartmentId(id);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const current = await lockDepartment(tx, orgId, id);
    await tx.delete(departments).where(and(eq(departments.organizationId, orgId), eq(departments.id, id)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "department.deleted",
      entityType: "department",
      entityId: id,
      changes: { name: current.name, description: current.description, isActive: current.isActive },
    });
  });
}
