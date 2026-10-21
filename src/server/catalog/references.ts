import "server-only";
import { and, asc, count, eq, ilike, type SQL } from "drizzle-orm";
import { brands, categories, suppliers } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { diffFields, recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { conflict, isUniqueViolation, notFound } from "@/server/errors";
import { likePattern, pageResult, pageWindow } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";
import { assertCanManageCatalog, filledFields, parseOrThrow } from "./queries";
import {
  referenceInputSchema,
  supplierInputSchema,
  type ReferenceFilters,
  type ReferenceInput,
  type SupplierFilters,
  type SupplierInput,
} from "./schemas";

// Categories, brands and suppliers: organization-wide lists referenced by
// products. They are deactivated instead of deleted, because products keep
// pointing at them.

export const REFERENCE_LIST_LIMIT = 500;

// Categories and brands share the same columns; the kind picks table, audit keys and messages.
const KINDS = {
  category: {
    table: categories,
    nameConstraint: "categories_org_name_idx",
    taken: "Já existe uma categoria com este nome.",
    missing: "Categoria não encontrada.",
  },
  brand: {
    table: brands,
    nameConstraint: "brands_org_name_idx",
    taken: "Já existe uma marca com este nome.",
    missing: "Marca não encontrada.",
  },
} as const;
export type ReferenceKind = keyof typeof KINDS;

// Both tables have identical columns, so one typed handle serves both.
const tableOf = (kind: ReferenceKind) => KINDS[kind].table as typeof categories;

async function lockReference(tx: Tx, kind: ReferenceKind, organizationId: string, id: string) {
  const table = tableOf(kind);
  const [row] = await tx
    .select({ name: table.name, isActive: table.isActive })
    .from(table)
    .where(and(eq(table.organizationId, organizationId), eq(table.id, id)))
    .for("update");
  if (!row) throw notFound(KINDS[kind].missing);
  return row;
}

function translateNameTaken(kind: ReferenceKind, error: unknown): never {
  if (isUniqueViolation(error, KINDS[kind].nameConstraint)) throw conflict(KINDS[kind].taken, { name: ["Nome já utilizado."] });
  throw error;
}

export async function listReferences(context: TenantContext, kind: ReferenceKind, filters: ReferenceFilters = {}) {
  assertCan(context, "catalog.read");
  const table = tableOf(kind);
  const status = filters.status ? eq(table.isActive, filters.status === "active") : undefined;
  return withScope(dbScope(context), (tx) =>
    tx
      .select({ id: table.id, name: table.name, isActive: table.isActive })
      .from(table)
      .where(and(eq(table.organizationId, context.organization.id), status))
      .orderBy(asc(table.name), asc(table.id))
      .limit(REFERENCE_LIST_LIMIT),
  );
}

export async function createReference(context: TenantContext, kind: ReferenceKind, input: ReferenceInput) {
  assertCanManageCatalog(context);
  const { name } = parseOrThrow(referenceInputSchema, input);
  const orgId = context.organization.id;
  const table = tableOf(kind);
  try {
    return await withScope(dbScope(context), async (tx) => {
      const [created] = await tx.insert(table).values({ organizationId: orgId, name }).returning({ id: table.id });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: `${kind}.created`,
        entityType: kind,
        entityId: created.id,
        changes: { name },
      });
      return created;
    });
  } catch (error) {
    translateNameTaken(kind, error);
  }
}

/** Saving the same name writes nothing (no update, no audit entry). */
export async function updateReference(context: TenantContext, kind: ReferenceKind, id: string, input: ReferenceInput) {
  assertCanManageCatalog(context);
  const next = parseOrThrow(referenceInputSchema, input);
  if (!isUuid(id)) throw notFound(KINDS[kind].missing);
  const orgId = context.organization.id;
  const table = tableOf(kind);
  try {
    await withScope(dbScope(context), async (tx) => {
      const current = await lockReference(tx, kind, orgId, id);
      const changes = diffFields(current, next, ["name"]);
      if (Object.keys(changes).length === 0) return;
      await tx
        .update(table)
        .set({ name: next.name, updatedAt: new Date() })
        .where(and(eq(table.organizationId, orgId), eq(table.id, id)));
      await recordAudit(tx, { organizationId: orgId, actorUserId: context.user.id, action: `${kind}.updated`, entityType: kind, entityId: id, changes });
    });
  } catch (error) {
    translateNameTaken(kind, error);
  }
}

/** Inactive entries stay on existing products but are not offered for new ones. */
export async function setReferenceActive(context: TenantContext, kind: ReferenceKind, id: string, isActive: boolean) {
  assertCanManageCatalog(context);
  if (!isUuid(id)) throw notFound(KINDS[kind].missing);
  const orgId = context.organization.id;
  const table = tableOf(kind);
  await withScope(dbScope(context), async (tx) => {
    const current = await lockReference(tx, kind, orgId, id);
    if (current.isActive === isActive) return;
    await tx
      .update(table)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(table.organizationId, orgId), eq(table.id, id)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: `${kind}.updated`,
      entityType: kind,
      entityId: id,
      changes: { isActive: { from: current.isActive, to: isActive } },
    });
  });
}

// ---- Suppliers ----

const SUPPLIER_NOT_FOUND = () => notFound("Fornecedor não encontrado.");
const SUPPLIER_DOCUMENT_CONSTRAINT = "suppliers_org_document_idx";
const SUPPLIER_FIELDS = ["name", "document", "email", "phone"] as const;

function translateSupplierErrors(error: unknown): never {
  if (isUniqueViolation(error, SUPPLIER_DOCUMENT_CONSTRAINT)) {
    throw conflict("Já existe um fornecedor com este CNPJ.", { document: ["CNPJ já cadastrado nesta empresa."] });
  }
  throw error;
}

function supplierColumns(input: SupplierInput) {
  return { name: input.name, document: input.document ?? null, email: input.email ?? null, phone: input.phone ?? null };
}

export async function listSuppliers(context: TenantContext, filters: SupplierFilters) {
  assertCan(context, "catalog.read");
  const conditions: (SQL | undefined)[] = [eq(suppliers.organizationId, context.organization.id)];
  if (filters.q) conditions.push(ilike(suppliers.name, likePattern(filters.q)));
  if (filters.status) conditions.push(eq(suppliers.isActive, filters.status === "active"));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(suppliers).where(where);
    const rows = await tx
      .select({
        id: suppliers.id,
        name: suppliers.name,
        document: suppliers.document,
        email: suppliers.email,
        phone: suppliers.phone,
        isActive: suppliers.isActive,
      })
      .from(suppliers)
      .where(where)
      .orderBy(asc(suppliers.name), asc(suppliers.id))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}

export async function createSupplier(context: TenantContext, input: SupplierInput) {
  assertCanManageCatalog(context);
  const values = supplierColumns(parseOrThrow(supplierInputSchema, input));
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      const [created] = await tx.insert(suppliers).values({ organizationId: orgId, ...values }).returning({ id: suppliers.id });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "supplier.created",
        entityType: "supplier",
        entityId: created.id,
        changes: filledFields(values),
      });
      return created;
    });
  } catch (error) {
    translateSupplierErrors(error);
  }
}

export async function updateSupplier(context: TenantContext, id: string, input: SupplierInput) {
  assertCanManageCatalog(context);
  const next = supplierColumns(parseOrThrow(supplierInputSchema, input));
  if (!isUuid(id)) throw SUPPLIER_NOT_FOUND();
  const orgId = context.organization.id;
  const target = and(eq(suppliers.organizationId, orgId), eq(suppliers.id, id));
  try {
    await withScope(dbScope(context), async (tx) => {
      const [current] = await tx
        .select({ name: suppliers.name, document: suppliers.document, email: suppliers.email, phone: suppliers.phone })
        .from(suppliers)
        .where(target)
        .for("update");
      if (!current) throw SUPPLIER_NOT_FOUND();
      const changes = diffFields(current, next, SUPPLIER_FIELDS);
      if (Object.keys(changes).length === 0) return;
      await tx
        .update(suppliers)
        .set({ ...next, updatedAt: new Date() })
        .where(target);
      await recordAudit(tx, { organizationId: orgId, actorUserId: context.user.id, action: "supplier.updated", entityType: "supplier", entityId: id, changes });
    });
  } catch (error) {
    translateSupplierErrors(error);
  }
}

export async function setSupplierActive(context: TenantContext, id: string, isActive: boolean) {
  assertCanManageCatalog(context);
  if (!isUuid(id)) throw SUPPLIER_NOT_FOUND();
  const orgId = context.organization.id;
  const target = and(eq(suppliers.organizationId, orgId), eq(suppliers.id, id));
  await withScope(dbScope(context), async (tx) => {
    const [current] = await tx.select({ isActive: suppliers.isActive }).from(suppliers).where(target).for("update");
    if (!current) throw SUPPLIER_NOT_FOUND();
    if (current.isActive === isActive) return;
    await tx
      .update(suppliers)
      .set({ isActive, updatedAt: new Date() })
      .where(target);
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "supplier.updated",
      entityType: "supplier",
      entityId: id,
      changes: { isActive: { from: current.isActive, to: isActive } },
    });
  });
}
