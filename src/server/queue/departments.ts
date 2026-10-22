import "server-only";
import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { departments, salespeople, salespersonDepartments } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { invalid, notFound } from "@/server/errors";
import { visibleSalespeople } from "@/server/salespeople/service";
import { isUuid } from "@/server/stores/schemas";

// Sectors/specialties of a salesperson for the queue rotation (departments of the organization).

const schema = z.object({ departmentIds: z.array(z.uuid({ error: "Setor inválido." })).max(50) });

export async function setSalespersonDepartments(context: TenantContext, salespersonId: string, rawInput: unknown): Promise<void> {
  assertCan(context, "salespeople.manage");
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) throw invalid("Revise os campos destacados.", { departmentIds: ["Setor inválido."] });
  if (!isUuid(salespersonId)) throw notFound("Vendedor não encontrado.");
  const departmentIds = [...new Set(parsed.data.departmentIds)];
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const [salesperson] = await tx
      .select({ id: salespeople.id, code: salespeople.code })
      .from(salespeople)
      .where(and(eq(salespeople.organizationId, orgId), eq(salespeople.id, salespersonId), visibleSalespeople(context)))
      .for("update");
    if (!salesperson) throw notFound("Vendedor não encontrado.");
    if (departmentIds.length) {
      const [found] = await tx.select({ value: count() }).from(departments).where(and(eq(departments.organizationId, orgId), inArray(departments.id, departmentIds), eq(departments.isActive, true)));
      if (found.value !== departmentIds.length) throw invalid("Revise os campos destacados.", { departmentIds: ["Setor não encontrado."] });
    }
    await tx.delete(salespersonDepartments).where(and(eq(salespersonDepartments.organizationId, orgId), eq(salespersonDepartments.salespersonId, salesperson.id)));
    if (departmentIds.length) await tx.insert(salespersonDepartments).values(departmentIds.map((departmentId) => ({ organizationId: orgId, salespersonId: salesperson.id, departmentId })));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "salesperson.departments_set",
      entityType: "salesperson",
      entityId: salesperson.id,
      changes: { code: salesperson.code, departmentIds },
    });
  });
}
